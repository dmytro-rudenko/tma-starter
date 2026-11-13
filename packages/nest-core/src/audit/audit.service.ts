import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Knex } from 'knex';
import { apiError } from '../common/api-error';
import { ResolvedTmaCoreOptions } from '../options';
import { TMA_CORE_OPTIONS, TMA_KNEX } from '../tokens';

export type TmaCoreAuditAction =
  | 'user.block'
  | 'user.unblock'
  | 'admin.grant'
  | 'admin.revoke'
  | 'settings.update';

export interface AuditRecordInput {
  actorId: number | null;
  action: TmaCoreAuditAction | (string & {});
  targetType?: string | null;
  targetId?: string | number | null;
  meta?: unknown;
}

export interface AuditEvent {
  id: number;
  at: Date;
  actorId: number | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: unknown;
}

export interface AuditListQuery {
  actorId?: number;
  targetType?: string;
  targetId?: string;
  cursor?: string | null;
  limit?: number;
}

export interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}

export const AUDIT_META_MAX_BYTES = 4096;
export const AUDIT_PAGE_SIZE = 50;

const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_STRING_CHARS = 200;
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_(\d{1,19})$/;

interface AuditRow {
  id: string | number;
  at: Date;
  actor_id: string | number | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: unknown;
  at_cursor: string;
}

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_CORE_OPTIONS) private readonly opts: ResolvedTmaCoreOptions,
  ) {}

  onModuleInit(): void {
    if (!this.opts.runWorker) return;
    void this.safePrune();
    this.timer = setInterval(() => void this.safePrune(), PRUNE_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async record(db: Knex | Knex.Transaction, e: AuditRecordInput): Promise<void> {
    await db('audit_events').insert({
      actor_id: e.actorId ?? null,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId === undefined || e.targetId === null ? null : String(e.targetId),
      meta: serializeMeta(e.meta),
    });
  }

  async prune(): Promise<void> {
    await this.knex('audit_events')
      .where('at', '<', this.knex.raw('now() - make_interval(days => ?)', [this.opts.auditRetentionDays]))
      .del();
  }

  async list({ actorId, targetType, targetId, cursor, limit = AUDIT_PAGE_SIZE }: AuditListQuery = {}): Promise<AuditPage> {
    const size = clamp(limit, AUDIT_PAGE_SIZE);
    const query = this.knex('audit_events')
      .select(
        '*',
        this.knex.raw(
          `to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at_cursor`,
        ),
      )
      .orderBy([
        { column: 'at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(size + 1);
    if (actorId !== undefined) query.where('actor_id', actorId);
    if (targetType !== undefined) query.where('target_type', targetType);
    if (targetId !== undefined) query.where('target_id', targetId);
    if (cursor) {
      const m = CURSOR_RE.exec(cursor);
      if (!m) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad cursor');
      query.whereRaw('(at, id) < (?::timestamptz, ?)', [m[1], m[2]]);
    }
    const rows: AuditRow[] = await query;
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      items: page.map(toAuditEvent),
      nextCursor: rows.length > size && last ? `${last.at_cursor}_${last.id}` : null,
    };
  }

  private async safePrune(): Promise<void> {
    try {
      await this.prune();
    } catch (err) {
      this.logger.warn(`audit prune failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function toAuditEvent(r: AuditRow): AuditEvent {
  return {
    id: Number(r.id),
    at: r.at,
    actorId: r.actor_id === null ? null : Number(r.actor_id),
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    meta: r.meta,
  };
}

function clamp(limit: number, fallback: number): number {
  const n = Math.trunc(Number(limit));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(1, n));
}

function serializeMeta(meta: unknown): string | null {
  if (meta === undefined || meta === null) return null;
  const json: string | undefined = JSON.stringify(meta);
  if (json === undefined) return null;
  const bytes = Buffer.byteLength(json);
  if (bytes <= AUDIT_META_MAX_BYTES) return json;
  const shortened = JSON.stringify(shorten(JSON.parse(json)));
  if (Buffer.byteLength(shortened) <= AUDIT_META_MAX_BYTES) return shortened;
  return JSON.stringify({ truncated: true, bytes });
}

function shorten(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS ? `${value.slice(0, MAX_STRING_CHARS)}…` : value;
  }
  if (Array.isArray(value)) return value.map(shorten);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shorten(v)]));
  }
  return value;
}
