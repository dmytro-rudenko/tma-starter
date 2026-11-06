import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { knex as createKnex, Knex } from 'knex';
import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import {
  BroadcastAudienceRegistry,
  TmaBotModule,
  migrations as botMigrations,
} from '@dmytro-rudenko/tma-nest-bot';
import { createTestApp, createTestDatabase, waitFor } from '@dmytro-rudenko/tma-testing';

jest.setTimeout(120_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string };

const BOT_TOKEN = '123456:BOT-TEST';
const WEBAPP_URL = 'https://demo.example.com';
const PATH_TOKEN = 'path-token-0123456789';
const SECRET = 'secret-0123456789abcdef';
const ADMIN: TgUser = { id: 1001, first_name: 'Admin' };
const MIGRATIONS = composeMigrations(coreMigrations, botMigrations);

@Injectable()
class VipFilterSetup implements OnModuleInit {
  constructor(
    @Inject(BroadcastAudienceRegistry) private readonly audience: BroadcastAudienceRegistry,
  ) {}

  onModuleInit(): void {
    this.audience.register({
      key: 'vip',
      label: 'VIP',
      apply: (qb: Knex.QueryBuilder, value: unknown) => qb.whereIn('users.id', value as number[]),
    });
  }
}

@Module({ providers: [VipFilterSetup] })
class VipFilterModule {}

function botImports(knex: Knex, ctx: { botToken: string; apiRoot: string }, runWorker: boolean) {
  return [
    TmaCoreModule.forRoot({
      knex,
      botToken: ctx.botToken,
      adminUserIds: [ADMIN.id],
      runWorker: false,
      throttle: { ttlMs: 60_000, limit: 100_000 },
    }),
    TmaBotModule.forRoot({
      botToken: ctx.botToken,
      botUsername: 'demo_app_bot',
      webappUrl: WEBAPP_URL,
      webhookPathToken: PATH_TOKEN,
      webhookSecret: SECRET,
      apiRoot: ctx.apiRoot,
      runWorker,
    }),
    VipFilterModule,
  ];
}

function boot(runWorker: boolean): Promise<TestApp> {
  return createTestApp({
    botToken: BOT_TOKEN,
    migrations: MIGRATIONS,
    imports: (ctx) => botImports(ctx.knex, ctx, runWorker),
  });
}

function bootOn(knex: Knex, runWorker: boolean): Promise<TestApp> {
  return createTestApp({
    botToken: BOT_TOKEN,
    migrations: MIGRATIONS,
    imports: (ctx) => botImports(knex, ctx, runWorker),
  });
}

const auth = (t: TestApp) => 'tma ' + t.tokenFor(ADMIN);

const chatIds = (t: TestApp) =>
  t.fakeBot.callsOf('sendMessage').map((c) => Number(c.body.chat_id));

const err = (code: number, description: string, retryAfter?: number) => ({
  ok: false as const,
  error_code: code,
  description,
  ...(retryAfter !== undefined ? { parameters: { retry_after: retryAfter } } : {}),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureAdmin(t: TestApp): Promise<void> {
  expect((await t.http.get('/api/me').set('Authorization', auth(t))).status).toBe(200);
}

async function insertUsers(knex: Knex, ids: number[]): Promise<void> {
  await knex('users').insert(ids.map((id) => ({ id, first_name: `User ${id}` })));
}

function postBroadcast(t: TestApp, body: object) {
  return t.http.post('/api/admin/broadcasts').set('Authorization', auth(t)).send(body);
}

async function createVipBroadcast(t: TestApp, ids: number[]): Promise<string> {
  const res = await postBroadcast(t, { text: 'Hello <b>all</b>', audience: { filters: { vip: ids } } });
  expect(res.status).toBe(201);
  expect(res.body.total).toBe(ids.length);
  return res.body.id;
}

async function statusByUser(knex: Knex, broadcastId: string): Promise<Record<number, string>> {
  const rows = await knex('broadcast_deliveries').where({ broadcast_id: broadcastId });
  return Object.fromEntries(rows.map((r: any) => [Number(r.user_id), r.status]));
}

function afterNthCall(app: TestApp, method: string, n: number, timeoutMs = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (app.fakeBot.callsOf(method).length >= n) resolve();
      else if (Date.now() > deadline) reject(new Error(`${method} was not called ${n} times`));
      else setTimeout(tick, 2);
    };
    tick();
  });
}

async function sharedDb() {
  const db = await createTestDatabase({ migrations: MIGRATIONS });
  const knexes: Knex[] = [];
  const connect = () => {
    const k = createKnex({ client: 'pg', connection: db.url, pool: { min: 0, max: 4 } });
    knexes.push(k);
    return k;
  };
  const drop = async () => {
    for (const k of knexes) await k.destroy();
    await db.drop();
  };
  return { knex: db.knex, connect, drop };
}

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('broadcast lease acceptance', () => {
  it('cancel during a 429 pause returns within 1 s, skips the rest and stops sending', async () => {
    t = await boot(true);
    await ensureAdmin(t);
    const ids = [9001, 9002, 9003, 9004, 9005];
    await insertUsers(t.knex, ids);
    t.fakeBot.respond('sendMessage', err(429, 'Too Many Requests: retry after 3', 3), { times: 1 });

    const id = await createVipBroadcast(t, ids);
    await afterNthCall(t, 'sendMessage', 1);
    await sleep(100);

    const started = Date.now();
    const cancel = await t.http
      .post(`/api/admin/broadcasts/${id}/cancel`)
      .set('Authorization', auth(t));
    const elapsed = Date.now() - started;

    expect(cancel.status).toBeLessThan(300);
    expect(elapsed).toBeLessThan(1000);
    expect(await statusByUser(t.knex, id)).toEqual({
      9001: 'skipped',
      9002: 'skipped',
      9003: 'skipped',
      9004: 'skipped',
      9005: 'skipped',
    });
    expect((await t.knex('broadcasts').where({ id }).first()).status).toBe('canceled');

    await sleep(4000);

    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(1);
    expect(Object.values(await statusByUser(t.knex, id))).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect((await t.knex('broadcasts').where({ id }).first()).status).toBe('canceled');
  });

  it('a worker stopped mid-batch leaves sent rows sent and the next worker never re-sends them', async () => {
    const db = await sharedDb();
    let a: TestApp | undefined;
    let b: TestApp | undefined;
    try {
      a = await bootOn(db.connect(), true);
      await ensureAdmin(a);
      const ids = Array.from({ length: 10 }, (_, i) => 9101 + i);
      await insertUsers(db.knex, ids);

      const id = await createVipBroadcast(a, ids);
      await afterNthCall(a, 'sendMessage', 2);
      const appA = a;
      a = undefined;
      await appA.close();
      const sentByA = chatIds(appA);

      const sentBefore = await db
        .knex('broadcast_deliveries')
        .where({ broadcast_id: id, status: 'sent' })
        .select('user_id', 'sent_at');
      expect(sentBefore.map((r: any) => Number(r.user_id)).sort((x, y) => x - y)).toEqual(
        [...sentByA].sort((x, y) => x - y),
      );
      expect(sentBefore.length).toBeLessThan(ids.length);

      await db
        .knex('broadcast_deliveries')
        .where({ broadcast_id: id, status: 'pending' })
        .whereNotNull('claimed_at')
        .update({ claimed_at: db.knex.raw("now() - interval '6 minutes'") });

      b = await bootOn(db.connect(), true);
      await waitFor(async () => {
        const row = await db.knex('broadcasts').where({ id }).first();
        return row.status === 'done' ? row : null;
      }, 30_000);

      const sentByB = chatIds(b);
      expect(sentByB.length).toBeGreaterThan(0);
      expect([...sentByA, ...sentByB].sort((x, y) => x - y)).toEqual(ids);
      expect(sentByB.filter((u) => sentByA.includes(u))).toEqual([]);

      const after = await db
        .knex('broadcast_deliveries')
        .where({ broadcast_id: id })
        .whereIn(
          'user_id',
          sentBefore.map((r: any) => r.user_id),
        )
        .select('user_id', 'status', 'sent_at');
      const beforeAt = Object.fromEntries(
        sentBefore.map((r: any) => [Number(r.user_id), new Date(r.sent_at).getTime()]),
      );
      for (const r of after) {
        expect(r.status).toBe('sent');
        expect(new Date(r.sent_at).getTime()).toBe(beforeAt[Number(r.user_id)]);
      }
      expect(Object.values(await statusByUser(db.knex, id)).every((s) => s === 'sent')).toBe(true);
    } finally {
      await a?.close();
      await b?.close();
      await db.drop();
    }
  });

  it('reclaims a pending row whose lease is older than 5 minutes and leaves a fresh lease alone', async () => {
    const db = await sharedDb();
    let a: TestApp | undefined;
    let b: TestApp | undefined;
    try {
      a = await bootOn(db.connect(), false);
      await ensureAdmin(a);
      await insertUsers(db.knex, [9201, 9202]);
      const id = await createVipBroadcast(a, [9201, 9202]);
      await a.close();
      a = undefined;

      await db
        .knex('broadcast_deliveries')
        .where({ broadcast_id: id, user_id: 9201 })
        .update({ claimed_at: db.knex.raw("now() - interval '6 minutes'") });
      await db
        .knex('broadcast_deliveries')
        .where({ broadcast_id: id, user_id: 9202 })
        .update({ claimed_at: db.knex.raw("now() - interval '1 minute'") });

      b = await bootOn(db.connect(), true);
      await waitFor(async () => {
        const row = await db
          .knex('broadcast_deliveries')
          .where({ broadcast_id: id, user_id: 9201 })
          .first();
        return row.status === 'sent' ? row : null;
      }, 30_000);
      await sleep(1000);

      expect(chatIds(b)).toEqual([9201]);
      expect(await statusByUser(db.knex, id)).toEqual({ 9201: 'sent', 9202: 'pending' });
    } finally {
      await a?.close();
      await b?.close();
      await db.drop();
    }
  });

  it('create rejects text over 4096 chars and a startParam outside [A-Za-z0-9_-]{1,64} with 400 VALIDATION', async () => {
    t = await boot(false);
    await ensureAdmin(t);

    const longText = await postBroadcast(t, { text: 'a'.repeat(4097), audience: {} });
    expect(longText.status).toBe(400);
    expect(longText.body).toMatchObject({ statusCode: 400, code: 'VALIDATION' });

    const maxText = await postBroadcast(t, { text: 'a'.repeat(4096), audience: {} });
    expect(maxText.status).toBe(201);

    const badParam = await postBroadcast(t, {
      text: 'Hi',
      button: { text: 'Open', startParam: 'a&b' },
      audience: {},
    });
    expect(badParam.status).toBe(400);
    expect(badParam.body).toMatchObject({ statusCode: 400, code: 'VALIDATION' });

    const tooLongParam = await postBroadcast(t, {
      text: 'Hi',
      button: { text: 'Open', startParam: 'a'.repeat(65) },
      audience: {},
    });
    expect(tooLongParam.status).toBe(400);
    expect(tooLongParam.body).toMatchObject({ statusCode: 400, code: 'VALIDATION' });

    const goodParam = await postBroadcast(t, {
      text: 'Hi',
      button: { text: 'Open', startParam: 'shop_1-A' },
      audience: {},
    });
    expect(goodParam.status).toBe(201);

    expect(await t.knex('broadcasts').count({ n: '*' }).first()).toEqual({ n: '2' });
  });
});
