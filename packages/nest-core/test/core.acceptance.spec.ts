import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import {
  AdminUserCardRegistry,
  AppSettingsRegistry,
  AppSettingsService,
  RealtimeService,
  TmaCoreModule,
  composeMigrations,
  defineSetting,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { createTestApp, signInitData, waitFor } from '@dmytro-rudenko/tma-testing';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string; username?: string; language_code?: string };

const BOT_TOKEN = '123456:CORE-TEST';
const ADMIN: TgUser = { id: 1001, first_name: 'Admin' };
const ADMIN2: TgUser = { id: 1002, first_name: 'Second' };

@Injectable()
class DemoSetup implements OnModuleInit {
  constructor(
    @Inject(AppSettingsRegistry) private readonly settings: AppSettingsRegistry,
    @Inject(AdminUserCardRegistry) private readonly cards: AdminUserCardRegistry,
  ) {}

  onModuleInit(): void {
    this.settings.register(
      defineSetting<number>({
        key: 'demo.limit',
        default: 5,
        parse: (v: unknown) => {
          if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
            throw new Error('demo.limit must be a non-negative integer');
          }
          return v;
        },
      }),
    );
    this.cards.register('demo', async (userId: number) => ({ seen: userId }));
  }
}

@Module({ providers: [DemoSetup] })
class DemoModule {}

let t: TestApp;

const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const get = (u: TgUser, path: string) => t.http.get(path).set('Authorization', auth(u));
const post = (u: TgUser, path: string, body?: object) =>
  t.http.post(path).set('Authorization', auth(u)).send(body ?? {});
const del = (u: TgUser, path: string) => t.http.delete(path).set('Authorization', auth(u));
const patch = (u: TgUser, path: string, body: object) =>
  t.http.patch(path).set('Authorization', auth(u)).send(body);

function expectError(res: { status: number; body: any }, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ statusCode: status, code });
  expect(typeof res.body.message).toBe('string');
  expect(typeof res.body.error).toBe('string');
}

async function touch(u: TgUser): Promise<void> {
  const res = await get(u, '/api/me');
  expect(res.status).toBe(200);
}

async function auditCount(): Promise<number> {
  const row = await t.knex('audit_events').count<{ count: string }[]>({ count: '*' }).first();
  return Number(row!.count);
}

async function listenUrl(): Promise<string> {
  const server = t.app.getHttpServer();
  if (!server.listening) await t.app.listen(0, '127.0.0.1');
  return (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
}

function connect(url: string, initData: string): Socket {
  return io(url, {
    path: '/api/socket.io',
    auth: { initData },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function serverDisconnect(socket: Socket, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket was not disconnected')), timeoutMs);
    socket.on('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

beforeAll(async () => {
  t = await createTestApp({
    botToken: BOT_TOKEN,
    migrations: composeMigrations(coreMigrations),
    imports: (ctx) => [
      TmaCoreModule.forRoot({
        knex: ctx.knex,
        botToken: ctx.botToken,
        adminUserIds: [ADMIN.id, ADMIN2.id],
        runWorker: false,
        throttle: { ttlMs: 60_000, limit: 100_000 },
      }),
      DemoModule,
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

describe('tma-nest-core acceptance', () => {
  it('rejects missing / bad-hash / expired initData with 401 UNAUTHORIZED', async () => {
    const user: TgUser = { id: 2001, first_name: 'Olia' };

    expectError(await t.http.get('/api/me'), 401, 'UNAUTHORIZED');

    const params = new URLSearchParams(signInitData(user, BOT_TOKEN));
    params.set('hash', '0'.repeat(64));
    expectError(
      await t.http.get('/api/me').set('Authorization', 'tma ' + params.toString()),
      401,
      'UNAUTHORIZED',
    );

    const forged = signInitData(user, '999999:OTHER-TOKEN');
    expectError(
      await t.http.get('/api/me').set('Authorization', 'tma ' + forged),
      401,
      'UNAUTHORIZED',
    );

    const stale = signInitData(user, BOT_TOKEN, {
      authDate: Math.floor(Date.now() / 1000) - 86_400 - 120,
    });
    expectError(
      await t.http.get('/api/me').set('Authorization', 'tma ' + stale),
      401,
      'UNAUTHORIZED',
    );

    expect(await t.knex('users').where({ id: user.id }).first()).toBeUndefined();
  });

  it('upserts the user on first request', async () => {
    const user: TgUser = { id: 2002, first_name: 'Taras', username: 'taras_k', language_code: 'uk' };
    expect(await t.knex('users').where({ id: user.id }).first()).toBeUndefined();

    const res = await get(user, '/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 2002,
      firstName: 'Taras',
      username: 'taras_k',
      language: null,
      theme: 'system',
      isAdmin: false,
      adminSource: null,
    });

    const row = await t.knex('users').where({ id: user.id }).first();
    expect(row).toMatchObject({ first_name: 'Taras', username: 'taras_k', language_code: 'uk' });

    const renamed = await get({ ...user, first_name: 'Тарас' }, '/api/me');
    expect(renamed.status).toBe(200);
    expect((await t.knex('users').where({ id: user.id }).first()).first_name).toBe('Тарас');
    expect(await t.knex('users').where({ id: user.id })).toHaveLength(1);
  });

  it('GET /api/health is public', async () => {
    const res = await t.http.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('blocked user gets 403 USER_BLOCKED, env admin is never blocked', async () => {
    const user: TgUser = { id: 2003, first_name: 'Blocked' };
    await touch(user);

    const blocked = await post(ADMIN, `/api/admin/users/${user.id}/block`);
    expect(blocked.status).toBeLessThan(300);

    expectError(await get(user, '/api/me'), 403, 'USER_BLOCKED');
    expectError(await patch(user, '/api/me', { theme: 'dark' }), 403, 'USER_BLOCKED');

    await touch(ADMIN2);
    await t.knex('users').where({ id: ADMIN2.id }).update({ blocked_at: t.knex.fn.now() });
    const admin = await get(ADMIN2, '/api/me');
    expect(admin.status).toBe(200);
    expect(admin.body).toMatchObject({ id: ADMIN2.id, isAdmin: true, adminSource: 'env' });
    await t.knex('users').where({ id: ADMIN2.id }).update({ blocked_at: null });
  });

  it('non-admin gets 403 NOT_ADMIN on /api/admin/users', async () => {
    const user: TgUser = { id: 2004, first_name: 'Plain' };
    expectError(await get(user, '/api/admin/users'), 403, 'NOT_ADMIN');
    expectError(await get(user, '/api/admin/settings'), 403, 'NOT_ADMIN');
    expect((await get(ADMIN, '/api/admin/users')).status).toBe(200);
  });

  it('admin rules matrix', async () => {
    const plain: TgUser = { id: 2010, first_name: 'Plain' };
    const granted: TgUser = { id: 2011, first_name: 'Granted' };
    await touch(ADMIN);
    await touch(ADMIN2);
    await touch(plain);
    await touch(granted);

    expectError(await post(ADMIN, '/api/admin/users/999999/block'), 404, 'USER_NOT_FOUND');
    expectError(await post(ADMIN, `/api/admin/users/${ADMIN.id}/block`), 409, 'CANNOT_TARGET_SELF');
    expectError(await del(ADMIN, `/api/admin/users/${ADMIN.id}/admin`), 409, 'CANNOT_TARGET_SELF');
    expectError(await post(ADMIN, `/api/admin/users/${ADMIN2.id}/block`), 409, 'CANNOT_BLOCK_ADMIN');
    expectError(
      await del(ADMIN, `/api/admin/users/${ADMIN2.id}/admin`),
      409,
      'CANNOT_REVOKE_ENV_ADMIN',
    );

    expect((await post(ADMIN, `/api/admin/users/${plain.id}/block`)).status).toBeLessThan(300);
    expectError(await post(ADMIN, `/api/admin/users/${plain.id}/admin`), 409, 'CANNOT_GRANT_BLOCKED');

    expect((await post(ADMIN, `/api/admin/users/${granted.id}/admin`)).status).toBeLessThan(300);
    const me = await get(granted, '/api/me');
    expect(me.body).toMatchObject({ isAdmin: true, adminSource: 'granted' });
    expectError(await post(ADMIN, `/api/admin/users/${granted.id}/block`), 409, 'CANNOT_BLOCK_ADMIN');
    expectError(await post(granted, `/api/admin/users/${granted.id}/block`), 409, 'CANNOT_TARGET_SELF');

    const before = await auditCount();
    const regrant = await post(ADMIN, `/api/admin/users/${granted.id}/admin`);
    expect(regrant.status).toBeLessThan(300);
    expect(regrant.body).toMatchObject({ id: granted.id, adminSource: 'granted' });
    const reblock = await post(ADMIN, `/api/admin/users/${plain.id}/block`);
    expect(reblock.status).toBeLessThan(300);
    expect(reblock.body.blockedAt).toBeTruthy();
    expect(await auditCount()).toBe(before);

    expect((await del(ADMIN, `/api/admin/users/${granted.id}/admin`)).status).toBeLessThan(300);
    expect((await post(ADMIN, `/api/admin/users/${granted.id}/block`)).status).toBeLessThan(300);
    expect((await t.knex('users').where({ id: granted.id }).first()).blocked_at).not.toBeNull();
  });

  it('block/unblock/grant/revoke write audit_events in the same transaction', async () => {
    const user: TgUser = { id: 2020, first_name: 'Audited' };
    await touch(user);

    await t.knex.raw(
      "ALTER TABLE audit_events ADD CONSTRAINT test_no_block CHECK (action <> 'user.block') NOT VALID",
    );
    try {
      const res = await post(ADMIN, `/api/admin/users/${user.id}/block`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect((await t.knex('users').where({ id: user.id }).first()).blocked_at).toBeNull();
    } finally {
      await t.knex.raw('ALTER TABLE audit_events DROP CONSTRAINT test_no_block');
    }

    expect((await post(ADMIN, `/api/admin/users/${user.id}/block`)).status).toBeLessThan(300);
    expect((await del(ADMIN, `/api/admin/users/${user.id}/block`)).status).toBeLessThan(300);
    expect((await post(ADMIN, `/api/admin/users/${user.id}/admin`)).status).toBeLessThan(300);
    expect((await del(ADMIN, `/api/admin/users/${user.id}/admin`)).status).toBeLessThan(300);

    const rows = await t
      .knex('audit_events')
      .where({ target_id: String(user.id) })
      .orderBy('id', 'asc');
    expect(rows.map((r: any) => r.action)).toEqual([
      'user.block',
      'user.unblock',
      'admin.grant',
      'admin.revoke',
    ]);
    for (const r of rows) expect(Number(r.actor_id)).toBe(ADMIN.id);
  });

  it('users list paginates with cursor and searches by q (numeric id, ilike name)', async () => {
    const base = Date.now() - 3_600_000;
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: 3000 + i,
      first_name: `Bulk ${i}`,
      created_at: new Date(base + Math.floor(i / 2) * 1000),
      updated_at: new Date(base + Math.floor(i / 2) * 1000),
    }));
    rows.push(
      { id: 3070, first_name: 'Zoryana', created_at: new Date(base), updated_at: new Date(base) },
      { id: 3071, first_name: 'Petro', created_at: new Date(base), updated_at: new Date(base) },
    );
    await t.knex('users').insert(rows);
    await t.knex('users').where({ id: 3071 }).update({ username: 'zorro_x' });

    const expected = (
      await t.knex('users').select('id').orderBy([
        { column: 'created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
    ).map((r: any) => Number(r.id));
    expect(expected.length).toBeGreaterThan(50);

    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const res = await get(ADMIN, `/api/admin/users${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(50);
      seen.push(...res.body.items.map((u: any) => u.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(seen).toEqual(expected);

    const byId = await get(ADMIN, '/api/admin/users?q=3005');
    expect(byId.body.items.map((u: any) => u.id)).toEqual([3005]);

    for (const q of ['zor', 'ZOR']) {
      const byName = await get(ADMIN, `/api/admin/users?q=${q}`);
      expect(byName.body.items.map((u: any) => u.id).sort()).toEqual([3070, 3071]);
    }
  });

  it('PATCH /api/admin/settings validates via parse, writes audit settings.update, cache invalidated', async () => {
    const list = await get(ADMIN, '/api/admin/settings');
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      expect.arrayContaining([{ key: 'demo.limit', value: 5, default: 5 }]),
    );

    const settings = t.app.get(AppSettingsService);
    expect(await settings.get<number>('demo.limit')).toBe(5);

    expectError(
      await patch(ADMIN, '/api/admin/settings', { key: 'demo.limit', value: 'many' }),
      400,
      'VALIDATION',
    );
    expectError(
      await patch(ADMIN, '/api/admin/settings', { key: 'nope.unknown', value: 1 }),
      400,
      'UNKNOWN_SETTING',
    );
    expect(await t.knex('audit_events').where({ action: 'settings.update' })).toHaveLength(0);

    const ok = await patch(ADMIN, '/api/admin/settings', { key: 'demo.limit', value: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.arrayContaining([{ key: 'demo.limit', value: 7, default: 5 }]));
    expect(await settings.get<number>('demo.limit')).toBe(7);

    const audit = await t.knex('audit_events').where({ action: 'settings.update' });
    expect(audit).toHaveLength(1);
    expect(Number(audit[0].actor_id)).toBe(ADMIN.id);
    expect(audit[0].meta).toHaveProperty('from');
    expect(audit[0].meta.to).toBe(7);

    await t.knex('app_settings').where({ key: 'demo.limit' }).update({ value: JSON.stringify(9) });
    expect(await settings.get<number>('demo.limit')).toBe(7);
  });

  it('PATCH /api/me stores language and theme', async () => {
    const user: TgUser = { id: 2030, first_name: 'Prefs', language_code: 'en' };
    const res = await patch(user, '/api/me', { language: 'uk', theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, language: 'uk', theme: 'dark' });

    const row = await t.knex('users').where({ id: user.id }).first();
    expect(row).toMatchObject({ language: 'uk', theme: 'dark' });

    const again = await get(user, '/api/me');
    expect(again.body).toMatchObject({ language: 'uk', theme: 'dark' });
  });

  it('realtime: valid initData joins user:<id>, invalid or expired initData disconnects; emitToUser delivers', async () => {
    const user: TgUser = { id: 2040, first_name: 'Live' };
    const url = await listenUrl();
    const realtime = t.app.get(RealtimeService);
    const sockets: Socket[] = [];

    try {
      const good = connect(url, signInitData(user, BOT_TOKEN));
      sockets.push(good);
      const received: unknown[] = [];
      good.on('demo.ping', (p) => received.push(p));
      await waitFor(async () => {
        realtime.emitToUser(user.id, 'demo.ping', { n: 1 });
        return received.length > 0;
      }, 5000);
      expect(received[0]).toEqual({ n: 1 });

      const params = new URLSearchParams(signInitData(user, BOT_TOKEN));
      params.set('hash', 'f'.repeat(64));
      const bad = connect(url, params.toString());
      sockets.push(bad);
      expect(await serverDisconnect(bad)).toBe('io server disconnect');

      const staleInitData = (u: TgUser) =>
        signInitData(u, BOT_TOKEN, { authDate: Math.floor(Date.now() / 1000) - 86_400 - 120 });
      const flood = setInterval(() => realtime.emitToUser(user.id, 'demo.ping', { n: 2 }), 5);
      try {
        const expired = connect(url, staleInitData(user));
        sockets.push(expired);
        const leaked: unknown[] = [];
        expired.on('demo.ping', (p) => leaked.push(p));
        expect(await serverDisconnect(expired)).toBe('io server disconnect');
        await new Promise((r) => setTimeout(r, 200));
        expect(leaked).toEqual([]);
      } finally {
        clearInterval(flood);
      }

      const returning: TgUser = { id: 2041, first_name: 'Returning' };
      const again = connect(url, signInitData(returning, BOT_TOKEN));
      sockets.push(again);
      const before: unknown[] = [];
      const after: unknown[] = [];
      let reconnected = false;
      again.on('demo.ping', (p) => (reconnected ? after : before).push(p));
      await waitFor(async () => {
        realtime.emitToUser(returning.id, 'demo.ping', { n: 3 });
        return before.length > 0;
      }, 5000);

      again.disconnect();
      reconnected = true;
      again.auth = { initData: staleInitData(returning) };
      const dropped = serverDisconnect(again);
      const flood2 = setInterval(() => realtime.emitToUser(returning.id, 'demo.ping', { n: 4 }), 5);
      try {
        again.connect();
        expect(await dropped).toBe('io server disconnect');
        await new Promise((r) => setTimeout(r, 200));
        expect(after).toEqual([]);
        expect(again.connected).toBe(false);
      } finally {
        clearInterval(flood2);
      }
    } finally {
      for (const s of sockets) s.disconnect();
    }
  });

  it('GET /api/admin/users/:id includes cards from AdminUserCardRegistry', async () => {
    const user: TgUser = { id: 2050, first_name: 'Carded' };
    await touch(user);

    const res = await get(ADMIN, `/api/admin/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      adminSource: null,
      blockedAt: null,
      cards: { demo: { seen: user.id } },
    });

    expectError(await get(ADMIN, '/api/admin/users/999998'), 404, 'USER_NOT_FOUND');
  });
});
