import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Knex } from 'knex';
import { AuditService } from '../audit/audit.service';
import type { TgUser } from '../auth/init-data';
import { apiError } from '../common/api-error';
import { isEnvAdmin, ResolvedTmaCoreOptions } from '../options';
import { TMA_CORE_OPTIONS, TMA_KNEX } from '../tokens';

export type TmaLanguage = 'uk' | 'en';
export type TmaTheme = 'system' | 'light' | 'dark';

export interface TmaUser {
  id: number;
  firstName: string;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  language: TmaLanguage | null;
  theme: TmaTheme;
  blockedAt: Date | null;
  adminGrantedAt: Date | null;
  adminGrantedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRow {
  id: string | number;
  first_name: string;
  username: string | null;
  photo_url: string | null;
  language_code: string | null;
  language: TmaLanguage | null;
  theme: TmaTheme;
  blocked_at: Date | null;
  admin_granted_at: Date | null;
  admin_granted_by: string | number | null;
  created_at: Date;
  updated_at: Date;
}

export interface UsersPage {
  items: TmaUser[];
  nextCursor: string | null;
}

export interface UsersListQuery {
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface UserPrefs {
  language?: TmaLanguage | null;
  theme?: TmaTheme;
}

export interface UserChange {
  user: TmaUser;
  changed: boolean;
}

const Q_MAX_CHARS = 64;
const DIGITS_RE = /^\d{1,16}$/;
const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)_(\d{1,16})$/;

export function toTmaUser(r: UserRow): TmaUser {
  return {
    id: Number(r.id),
    firstName: r.first_name,
    username: r.username,
    photoUrl: r.photo_url,
    languageCode: r.language_code,
    language: r.language,
    theme: r.theme,
    blockedAt: r.blocked_at,
    adminGrantedAt: r.admin_granted_at,
    adminGrantedBy: r.admin_granted_by === null ? null : Number(r.admin_granted_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_CORE_OPTIONS) private readonly opts: ResolvedTmaCoreOptions,
    private readonly audit: AuditService,
  ) {}

  async upsert(from: TgUser, trx?: Knex.Transaction): Promise<TmaUser> {
    const db = trx ?? this.knex;
    const profile = {
      first_name: from.first_name,
      username: from.username ?? null,
      photo_url: from.photo_url ?? null,
      language_code: from.language_code ?? null,
    };
    const rows: UserRow[] = await db('users')
      .insert({ id: from.id, ...profile })
      .onConflict('id')
      .merge({ ...profile, updated_at: db.fn.now() })
      .returning('*');
    return toTmaUser(rows[0]);
  }

  async get(id: number, db: Knex | Knex.Transaction = this.knex): Promise<TmaUser | null> {
    const row: UserRow | undefined = await db('users').where({ id }).first();
    return row ? toTmaUser(row) : null;
  }

  async isBlocked(id: number): Promise<boolean> {
    const row = await this.knex('users').where({ id }).first('blocked_at');
    return !!row?.blocked_at;
  }

  async list({ q, cursor, limit: requested = 50 }: UsersListQuery = {}): Promise<UsersPage> {
    const n = Math.trunc(Number(requested));
    const limit = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 50;
    const query = this.knex('users')
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
      .limit(limit + 1);
    const term = (q ?? '').trim().slice(0, Q_MAX_CHARS);
    if (DIGITS_RE.test(term)) {
      query.where('id', term);
    } else if (term !== '') {
      const like = `%${term.replace(/^@/, '').replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      query.where((w) => w.where('first_name', 'ilike', like).orWhere('username', 'ilike', like));
    }
    if (cursor) {
      const m = CURSOR_RE.exec(cursor);
      if (!m) throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', 'bad cursor');
      query.whereRaw('(created_at, id) < (?::timestamptz, ?)', [m[1], m[2]]);
    }
    const rows: (UserRow & { created_cursor: string })[] = await query;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toTmaUser),
      nextCursor: rows.length > limit && last ? `${last.created_cursor}_${last.id}` : null,
    };
  }

  async block(actorId: number, id: number): Promise<TmaUser> {
    return this.knex.transaction(async (trx) => {
      const r = await this.applyBlock(trx, actorId, id);
      if (r.changed) {
        await this.audit.record(trx, { actorId, action: 'user.block', targetType: 'user', targetId: id });
      }
      return r.user;
    });
  }

  async unblock(actorId: number, id: number): Promise<TmaUser> {
    return this.knex.transaction(async (trx) => {
      const r = await this.applyUnblock(trx, actorId, id);
      if (r.changed) {
        await this.audit.record(trx, { actorId, action: 'user.unblock', targetType: 'user', targetId: id });
      }
      return r.user;
    });
  }

  async applyBlock(trx: Knex.Transaction, actorId: number, id: number): Promise<UserChange> {
    const user = await this.lockForChange(trx, id);
    if (actorId === id) throw apiError(HttpStatus.CONFLICT, 'CANNOT_TARGET_SELF');
    if (isEnvAdmin(this.opts, id)) throw apiError(HttpStatus.CONFLICT, 'CANNOT_BLOCK_ADMIN');
    if (user.adminGrantedAt) throw apiError(HttpStatus.CONFLICT, 'CANNOT_BLOCK_ADMIN');
    if (user.blockedAt) return { user, changed: false };
    const [row]: UserRow[] = await trx('users')
      .where({ id })
      .update({ blocked_at: trx.fn.now(), updated_at: trx.fn.now() })
      .returning('*');
    return { user: toTmaUser(row), changed: true };
  }

  async applyUnblock(trx: Knex.Transaction, _actorId: number, id: number): Promise<UserChange> {
    const user = await this.lockForChange(trx, id);
    if (!user.blockedAt) return { user, changed: false };
    const [row]: UserRow[] = await trx('users')
      .where({ id })
      .update({ blocked_at: null, updated_at: trx.fn.now() })
      .returning('*');
    return { user: toTmaUser(row), changed: true };
  }

  async updatePrefs(id: number, prefs: UserPrefs): Promise<TmaUser> {
    const patch: Record<string, unknown> = {};
    if (prefs.language !== undefined) patch.language = prefs.language;
    if (prefs.theme !== undefined) patch.theme = prefs.theme;
    if (Object.keys(patch).length > 0) {
      await this.knex('users')
        .where({ id })
        .update({ ...patch, updated_at: this.knex.fn.now() });
    }
    const user = await this.get(id);
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND');
    return user;
  }

  async lockForChange(trx: Knex.Transaction, id: number): Promise<TmaUser> {
    const row: UserRow | undefined = await trx('users').where({ id }).forUpdate().first();
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND');
    return toTmaUser(row);
  }
}
