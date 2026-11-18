import type { Knex } from 'knex';
import { createTestDatabase, TestDatabase } from '@dmytro-rudenko/tma-testing';
import { composeMigrations } from './compose';
import { migrations } from './index';

type Mod = { up: (k: Knex) => Promise<void>; down: (k: Knex) => Promise<void> };

function fakeSource(names: string[]): { source: Knex.MigrationSource<string>; mods: Record<string, Mod> } {
  const mods: Record<string, Mod> = {};
  for (const n of names) mods[n] = { up: async () => undefined, down: async () => undefined };
  return {
    mods,
    source: {
      getMigrations: async () => [...names],
      getMigrationName: (m: string) => m,
      getMigration: async (m: string) => mods[m],
    },
  };
}

async function namesOf(source: Knex.MigrationSource<any>): Promise<string[]> {
  const list = await source.getMigrations([]);
  return list.map((m) => source.getMigrationName(m));
}

describe('core migrations', () => {
  it('lists exactly tma_core_001_init', async () => {
    expect(await namesOf(migrations)).toEqual(['tma_core_001_init']);
  });
});

describe('composeMigrations', () => {
  it('keeps argument order instead of sorting names', async () => {
    const payments = fakeSource(['tma_payments_001_init']);
    const bot = fakeSource(['tma_bot_001_init', 'tma_bot_002_broadcast']);
    const app = fakeSource(['aaa_app_001_first']);

    expect(await namesOf(composeMigrations(migrations, payments.source, bot.source, app.source))).toEqual([
      'tma_core_001_init',
      'tma_payments_001_init',
      'tma_bot_001_init',
      'tma_bot_002_broadcast',
      'aaa_app_001_first',
    ]);
  });

  it('keeps the order inside one source as the source gives it', async () => {
    const app = fakeSource(['zz_002_second', 'zz_001_first']);
    expect(await namesOf(composeMigrations(app.source))).toEqual(['zz_002_second', 'zz_001_first']);
  });

  it('resolves each migration from the source that listed it', async () => {
    const bot = fakeSource(['tma_bot_001_init']);
    const app = fakeSource(['app_001_first']);
    const composed = composeMigrations(bot.source, app.source);
    const list = await composed.getMigrations([]);

    expect(await composed.getMigration(list[0])).toBe(bot.mods['tma_bot_001_init']);
    expect(await composed.getMigration(list[1])).toBe(app.mods['app_001_first']);
  });

  it('puts core first when composed as core, bot, app', async () => {
    const bot = fakeSource(['tma_bot_001_init']);
    const app = fakeSource(['app_001_first']);
    expect(await namesOf(composeMigrations(migrations, bot.source, app.source))).toEqual([
      'tma_core_001_init',
      'tma_bot_001_init',
      'app_001_first',
    ]);
  });
});

describe('tma_core_001_init schema', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase({ migrations: composeMigrations(migrations) });
  });

  afterAll(async () => {
    await db?.drop();
  });

  async function columns(table: string) {
    const res = await db.knex.raw(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = ?
        order by column_name`,
      [table],
    );
    return Object.fromEntries(
      res.rows.map((r: any) => [r.column_name, { type: r.data_type, nullable: r.is_nullable === 'YES', def: r.column_default }]),
    );
  }

  async function indexDefs(table: string): Promise<string[]> {
    const res = await db.knex.raw(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = ?`,
      [table],
    );
    return res.rows.map((r: any) => r.indexdef as string);
  }

  it('creates users with the spec columns', async () => {
    const c = await columns('users');
    expect(Object.keys(c).sort()).toEqual(
      [
        'admin_granted_at',
        'admin_granted_by',
        'blocked_at',
        'created_at',
        'first_name',
        'id',
        'language',
        'language_code',
        'photo_url',
        'theme',
        'updated_at',
        'username',
      ].sort(),
    );
    expect(c.id).toMatchObject({ type: 'bigint', nullable: false });
    expect(c.first_name).toMatchObject({ type: 'text', nullable: false });
    expect(c.username).toMatchObject({ type: 'text', nullable: true });
    expect(c.photo_url).toMatchObject({ type: 'text', nullable: true });
    expect(c.language_code).toMatchObject({ type: 'text', nullable: true });
    expect(c.language).toMatchObject({ type: 'text', nullable: true });
    expect(c.theme).toMatchObject({ type: 'text', nullable: false });
    expect(c.theme.def).toMatch(/^'system'/);
    expect(c.blocked_at).toMatchObject({ type: 'timestamp with time zone', nullable: true });
    expect(c.admin_granted_at).toMatchObject({ type: 'timestamp with time zone', nullable: true });
    expect(c.admin_granted_by).toMatchObject({ type: 'bigint', nullable: true });
    expect(c.created_at).toMatchObject({ type: 'timestamp with time zone', nullable: false, def: 'now()' });
    expect(c.updated_at).toMatchObject({ type: 'timestamp with time zone', nullable: false, def: 'now()' });
  });

  it('indexes users by (created_at desc, id desc) and lower(username)', async () => {
    const defs = await indexDefs('users');
    expect(defs.some((d) => d.includes('(created_at DESC, id DESC)'))).toBe(true);
    expect(defs.some((d) => d.includes('(lower(username))'))).toBe(true);
  });

  it('defaults theme to system and checks theme and language values', async () => {
    await db.knex('users').insert({ id: 1, first_name: 'A' });
    expect((await db.knex('users').where({ id: 1 }).first()).theme).toBe('system');

    await db.knex('users').insert({ id: 2, first_name: 'B', language: 'uk', theme: 'dark' });
    await db.knex('users').insert({ id: 3, first_name: 'C', language: 'en', theme: 'light' });
    await expect(db.knex('users').insert({ id: 4, first_name: 'D', theme: 'blue' })).rejects.toThrow(/check constraint/);
    await expect(db.knex('users').insert({ id: 5, first_name: 'E', language: 'de' })).rejects.toThrow(/check constraint/);
  });

  it('creates audit_events with the spec columns and indexes', async () => {
    const c = await columns('audit_events');
    expect(Object.keys(c).sort()).toEqual(['action', 'actor_id', 'at', 'id', 'meta', 'target_id', 'target_type']);
    expect(c.id).toMatchObject({ type: 'bigint', nullable: false });
    expect(c.id.def).toMatch(/^nextval\(/);
    expect(c.at).toMatchObject({ type: 'timestamp with time zone', nullable: false, def: 'now()' });
    expect(c.actor_id).toMatchObject({ type: 'bigint', nullable: true });
    expect(c.action).toMatchObject({ type: 'text', nullable: false });
    expect(c.target_type).toMatchObject({ type: 'text', nullable: true });
    expect(c.target_id).toMatchObject({ type: 'text', nullable: true });
    expect(c.meta).toMatchObject({ type: 'jsonb', nullable: true });

    const defs = await indexDefs('audit_events');
    expect(defs.some((d) => d.endsWith('(at DESC)'))).toBe(true);
    expect(defs.some((d) => d.includes('(target_type, target_id, at DESC)'))).toBe(true);
    expect(defs.some((d) => d.includes('(actor_id, at DESC)'))).toBe(true);
  });

  it('creates app_settings with key text PK, value jsonb, updated_at', async () => {
    const c = await columns('app_settings');
    expect(Object.keys(c).sort()).toEqual(['key', 'updated_at', 'value']);
    expect(c.key).toMatchObject({ type: 'text', nullable: false });
    expect(c.value).toMatchObject({ type: 'jsonb', nullable: false });
    expect(c.updated_at).toMatchObject({ type: 'timestamp with time zone', nullable: false, def: 'now()' });

    const defs = await indexDefs('app_settings');
    expect(defs.some((d) => d.includes('UNIQUE INDEX') && d.endsWith('(key)'))).toBe(true);
  });
});
