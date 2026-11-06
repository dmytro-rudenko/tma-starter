import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { apiError, AuditService, TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { GrammyError } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { Knex } from 'knex';
import { BotService } from '../bot.service';
import { BotLang } from '../lang';
import { TMA_BOT_OPTIONS, ResolvedTmaBotOptions } from '../options';
import { BroadcastAudienceRegistry } from './audience.registry';

export type BroadcastStatus = 'queued' | 'running' | 'done' | 'canceled';

export interface BroadcastButton {
  text: string;
  startParam?: string;
}

export interface BroadcastAudience {
  languages?: BotLang[];
  filters?: Record<string, unknown>;
}

export interface BroadcastInput {
  text: string;
  button?: BroadcastButton | null;
  audience: BroadcastAudience;
}

export interface BroadcastView {
  id: string;
  createdBy: number;
  text: string;
  button: BroadcastButton | null;
  audience: BroadcastAudience;
  status: BroadcastStatus;
  total: number;
  sent: number;
  failed: number;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface BroadcastListQuery {
  cursor?: string | null;
  limit?: number;
}

export interface BroadcastPage {
  items: BroadcastView[];
  nextCursor: string | null;
}

export const BROADCAST_PAGE_SIZE = 50;

const LANGUAGES: readonly BotLang[] = ['uk', 'en'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface BroadcastRow {
  id: string;
  created_by: string | number;
  text: string;
  button: BroadcastButton | null;
  audience: BroadcastAudience;
  status: BroadcastStatus;
  total: number;
  sent: number;
  failed: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  created_cursor?: string;
}

const invalid = (message: string) => apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', message);
const notFound = () => apiError(HttpStatus.NOT_FOUND, 'BROADCAST_NOT_FOUND', 'Broadcast not found');
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseBroadcastAudience(value: unknown): BroadcastAudience {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw invalid('audience must be an object');
  const audience: BroadcastAudience = {};
  if (value.languages !== undefined) {
    const langs = value.languages;
    if (!Array.isArray(langs) || !langs.every((l) => LANGUAGES.includes(l as BotLang))) {
      throw invalid('audience.languages must be an array of uk|en');
    }
    audience.languages = [...new Set(langs as BotLang[])];
  }
  if (value.filters !== undefined) {
    if (!isObject(value.filters)) throw invalid('audience.filters must be an object');
    audience.filters = value.filters;
  }
  return audience;
}

export function parseBroadcastInput(body: unknown): BroadcastInput {
  const value = isObject(body) ? body : {};
  if (typeof value.text !== 'string' || value.text.trim() === '') {
    throw invalid('text must be a non-empty string');
  }
  let button: BroadcastButton | null = null;
  if (value.button !== undefined && value.button !== null) {
    const b = value.button;
    if (!isObject(b) || typeof b.text !== 'string' || b.text.trim() === '') {
      throw invalid('button.text must be a non-empty string');
    }
    if (b.startParam !== undefined && (typeof b.startParam !== 'string' || b.startParam === '')) {
      throw invalid('button.startParam must be a non-empty string');
    }
    button = b.startParam === undefined ? { text: b.text } : { text: b.text, startParam: b.startParam };
  }
  return { text: value.text, button, audience: parseBroadcastAudience(value.audience) };
}

function toView(row: BroadcastRow): BroadcastView {
  return {
    id: row.id,
    createdBy: Number(row.created_by),
    text: row.text,
    button: row.button,
    audience: row.audience,
    status: row.status,
    total: row.total,
    sent: row.sent,
    failed: row.failed,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

@Injectable()
export class BroadcastService {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_BOT_OPTIONS) private readonly opts: ResolvedTmaBotOptions,
    private readonly bots: BotService,
    private readonly audit: AuditService,
    private readonly registry: BroadcastAudienceRegistry,
  ) {}

  markup(button: BroadcastButton | null | undefined): InlineKeyboardMarkup | undefined {
    if (!button) return undefined;
    return {
      inline_keyboard: [
        [
          button.startParam
            ? { text: button.text, url: this.bots.startAppUrl(button.startParam) }
            : { text: button.text, web_app: { url: this.opts.webappUrl } },
        ],
      ],
    };
  }

  recipients(db: Knex | Knex.Transaction, audience: BroadcastAudience): Knex.QueryBuilder {
    const qb = db('users').whereNull('users.blocked_at').whereNull('users.bot_blocked_at');
    if (audience.languages?.length) {
      qb.whereRaw(
        "coalesce(users.language, case when users.language_code = 'uk' then 'uk' else 'en' end) = any(?)",
        [audience.languages],
      );
    }
    this.registry.apply(qb, audience.filters ?? {});
    return qb;
  }

  async create(adminId: number, input: BroadcastInput): Promise<{ id: string; total: number }> {
    const audience = parseBroadcastAudience(input.audience);
    return this.knex.transaction(async (trx) => {
      const [row] = await trx('broadcasts')
        .insert({
          created_by: adminId,
          text: input.text,
          button: input.button ? JSON.stringify(input.button) : null,
          audience: JSON.stringify(audience),
          status: 'queued',
        })
        .returning('id');
      const id: string = row.id;
      const { sql, bindings } = this.recipients(trx, audience)
        .select(trx.raw('?::uuid', [id]), 'users.id')
        .toSQL();
      const inserted = await trx.raw(
        `insert into broadcast_deliveries (broadcast_id, user_id) ${sql}`,
        bindings,
      );
      const total: number = inserted.rowCount ?? 0;
      await trx('broadcasts').where({ id }).update({ total });
      await this.audit.record(trx, {
        actorId: adminId,
        action: 'broadcast.create',
        targetType: 'broadcast',
        targetId: id,
        meta: { total, audience },
      });
      return { id, total };
    });
  }

  async estimate(audience: BroadcastAudience): Promise<{ total: number }> {
    const parsed = parseBroadcastAudience(audience);
    const row = await this.recipients(this.knex, parsed).count<{ count: string }[]>({ count: '*' });
    return { total: Number(row[0].count) };
  }

  async preview(adminId: number, input: Pick<BroadcastInput, 'text' | 'button'>): Promise<{ ok: true }> {
    try {
      await this.bots.bot.api.sendMessage(adminId, input.text, {
        parse_mode: 'HTML',
        reply_markup: this.markup(input.button),
      });
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 400) throw invalid(err.description);
      throw err;
    }
    return { ok: true };
  }

  async list({ cursor, limit = BROADCAST_PAGE_SIZE }: BroadcastListQuery = {}): Promise<BroadcastPage> {
    const size = Math.min(Math.max(Math.trunc(limit) || BROADCAST_PAGE_SIZE, 1), BROADCAST_PAGE_SIZE);
    const query = this.knex('broadcasts')
      .select(
        '*',
        this.knex.raw(
          `to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_cursor`,
        ),
      )
      .orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(size + 1);
    if (cursor) {
      const match = CURSOR_RE.exec(cursor);
      if (!match) throw invalid('invalid cursor');
      query.whereRaw('(created_at, id) < (?::timestamptz, ?::uuid)', [match[1], match[2]]);
    }
    const rows: BroadcastRow[] = await query;
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      items: page.map(toView),
      nextCursor: rows.length > size && last ? `${last.created_cursor}_${last.id}` : null,
    };
  }

  async get(id: string): Promise<BroadcastView> {
    if (!UUID_RE.test(id)) throw notFound();
    const row: BroadcastRow | undefined = await this.knex('broadcasts').where({ id }).first();
    if (!row) throw notFound();
    return toView(row);
  }

  async cancel(adminId: number, id: string): Promise<BroadcastView> {
    const current = await this.get(id);
    if (current.status === 'done' || current.status === 'canceled') return current;
    await this.knex.transaction(async (trx) => {
      const skipped = await trx('broadcast_deliveries')
        .where({ broadcast_id: id, status: 'pending' })
        .update({ status: 'skipped' });
      const updated = await trx('broadcasts')
        .where({ id })
        .whereIn('status', ['queued', 'running'])
        .update({ status: 'canceled', finished_at: trx.fn.now() });
      if (!updated) return;
      await this.audit.record(trx, {
        actorId: adminId,
        action: 'broadcast.cancel',
        targetType: 'broadcast',
        targetId: id,
        meta: { skipped },
      });
    });
    return this.get(id);
  }
}
