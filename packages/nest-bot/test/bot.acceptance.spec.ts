import { execFile } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { knex as createKnex, Knex } from 'knex';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import {
  BotService,
  BroadcastAudienceRegistry,
  NotificationsService,
  TmaBotModule,
  migrations as botMigrations,
} from '@dmytro-rudenko/tma-nest-bot';
import {
  createTestApp,
  createTestDatabase,
  postWebhook,
  startFakeBotApi,
  updates,
  waitFor,
} from '@dmytro-rudenko/tma-testing';

jest.setTimeout(120_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string; username?: string; language_code?: string };

const BOT_TOKEN = '123456:BOT-TEST';
const BOT_USERNAME = 'demo_app_bot';
const WEBAPP_URL = 'https://demo.example.com';
const PATH_TOKEN = 'path-token-0123456789';
const SECRET = 'secret-0123456789abcdef';
const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
const ADMIN: TgUser = { id: 1001, first_name: 'Admin' };
const MIGRATIONS = composeMigrations(coreMigrations, botMigrations);

const seen = { payments: [] as string[], routed: [] as string[] };

@Injectable()
class TestBotSetup implements OnModuleInit {
  constructor(
    @Inject(BotService) private readonly bot: BotService,
    @Inject(BroadcastAudienceRegistry) private readonly audience: BroadcastAudienceRegistry,
  ) {}

  onModuleInit(): void {
    this.bot.on(
      'message:successful_payment',
      async (ctx: any) => {
        const payload: string = ctx.message.successful_payment.invoice_payload;
        if (payload === 'boom') throw new Error('critical handler failed');
        seen.payments.push(payload);
      },
      { critical: true },
    );
    this.bot.on('callback_query:data', async () => {
      throw new Error('non-critical handler failed');
    });
    this.audience.register({
      key: 'vip',
      label: 'VIP',
      apply: (qb: Knex.QueryBuilder, value: unknown) => qb.whereIn('users.id', value as number[]),
    });
  }
}

@Module({ providers: [TestBotSetup] })
class TestBotModule {}

const startParams = [
  {
    pattern: /^shop$/,
    handle: async (ctx: any, match: RegExpMatchArray) => {
      seen.routed.push(match[0]);
      await ctx.reply('shop opened');
    },
  },
];

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
      botUsername: BOT_USERNAME,
      webappUrl: WEBAPP_URL,
      webhookPathToken: PATH_TOKEN,
      webhookSecret: SECRET,
      apiRoot: ctx.apiRoot,
      startParams,
      runWorker,
    }),
    TestBotModule,
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

const auth = (t: TestApp, u: TgUser) => 'tma ' + t.tokenFor(u);

const sendsTo = (t: TestApp, chatId: number) =>
  t.fakeBot.callsOf('sendMessage').filter((c) => Number(c.body.chat_id) === chatId);

const chatIds = (t: TestApp) =>
  t.fakeBot.callsOf('sendMessage').map((c) => Number(c.body.chat_id));

function markupOf(body: any): any {
  return typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup;
}

async function insertUsers(
  knex: Knex,
  rows: Array<{ id: number; language_code?: string | null; language?: string | null }>,
): Promise<void> {
  await knex('users').insert(rows.map((r) => ({ first_name: `User ${r.id}`, ...r })));
}

async function createBroadcast(t: TestApp, audience: object, text = 'Hello <b>all</b>') {
  const res = await t.http
    .post('/api/admin/broadcasts')
    .set('Authorization', auth(t, ADMIN))
    .send({ text, audience });
  return res;
}

async function deliveries(knex: Knex, broadcastId: string) {
  const rows = await knex('broadcast_deliveries').where({ broadcast_id: broadcastId });
  return rows.map((r: any) => ({ ...r, user_id: Number(r.user_id) }));
}

async function recipients(knex: Knex, broadcastId: string): Promise<number[]> {
  return (await deliveries(knex, broadcastId)).map((d) => d.user_id).sort((a, b) => a - b);
}

async function waitDone(knex: Knex, broadcastId: string, timeoutMs = 30_000) {
  return waitFor(async () => {
    const b = await knex('broadcasts').where({ id: broadcastId }).first();
    return b.status === 'done' ? b : null;
  }, timeoutMs);
}

function afterNthCall(app: TestApp, method: string, n: number, arm: () => void, timeoutMs = 20_000) {
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (app.fakeBot.callsOf(method).length >= n) {
        arm();
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`${method} was not called ${n} times`));
      } else {
        setTimeout(tick, 2);
      }
    };
    tick();
  });
}

const err = (code: number, description: string, retryAfter?: number) => ({
  ok: false,
  error_code: code,
  description,
  ...(retryAfter !== undefined ? { parameters: { retry_after: retryAfter } } : {}),
});

let t: TestApp | undefined;

beforeEach(() => {
  seen.payments.length = 0;
  seen.routed.length = 0;
});

afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('tma-nest-bot acceptance', () => {
  it('webhook rejects wrong path token or secret with 401', async () => {
    t = await boot(false);
    const user: TgUser = { id: 2001, first_name: 'Olia' };
    const update = updates.message({ from: user, text: 'hello' });

    expect((await postWebhook(t.http, update, { pathToken: 'wrong', secret: SECRET })).status).toBe(401);
    expect((await postWebhook(t.http, update, { pathToken: PATH_TOKEN, secret: 'wrong' })).status).toBe(401);
    expect(
      (await t.http.post(`/bot/${PATH_TOKEN}`).send(updates.message({ from: user, text: 'x' }))).status,
    ).toBe(401);
    expect((await postWebhook(t.http, updates.message({ from: user, text: 'ok' }), HOOK)).status).toBe(200);
  });

  it('critical handler failure → 500, non-critical failure → 200', async () => {
    t = await boot(false);
    const user: TgUser = { id: 2002, first_name: 'Taras' };

    const critical = await postWebhook(
      t.http,
      updates.successfulPayment({ payload: 'boom', chargeId: 'ch_boom', totalAmount: 1, from: user }),
      HOOK,
    );
    expect(critical.status).toBe(500);

    const nonCritical = await postWebhook(
      t.http,
      {
        update_id: 900_001,
        callback_query: {
          id: 'cb1',
          from: { id: user.id, is_bot: false, first_name: user.first_name },
          chat_instance: 'ci-1',
          data: 'boom',
        },
      },
      HOOK,
    );
    expect(nonCritical.status).toBe(200);

    const ok = await postWebhook(
      t.http,
      updates.successfulPayment({ payload: 'fine', chargeId: 'ch_fine', totalAmount: 1, from: user }),
      HOOK,
    );
    expect(ok.status).toBe(200);
    expect(seen.payments).toEqual(['fine']);
  });

  it('blocked user: /start ignored, successful_payment still reaches handler', async () => {
    t = await boot(false);
    const user: TgUser = { id: 2003, first_name: 'Blocked' };
    await insertUsers(t.knex, [{ id: user.id }]);
    await t.knex('users').where({ id: user.id }).update({ blocked_at: t.knex.fn.now() });

    expect((await postWebhook(t.http, updates.command('start', undefined, user), HOOK)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(sendsTo(t, user.id)).toHaveLength(0);

    const paid = await postWebhook(
      t.http,
      updates.successfulPayment({ payload: 'blocked-pay', chargeId: 'ch_b', totalAmount: 5, from: user }),
      HOOK,
    );
    expect(paid.status).toBe(200);
    expect(seen.payments).toEqual(['blocked-pay']);
  });

  it('incoming message clears users.bot_blocked_at', async () => {
    t = await boot(false);
    const user: TgUser = { id: 2004, first_name: 'Back', language_code: 'uk' };
    await insertUsers(t.knex, [{ id: user.id, language_code: 'uk' }]);
    await t.knex('users').where({ id: user.id }).update({ bot_blocked_at: t.knex.fn.now() });

    expect((await postWebhook(t.http, updates.message({ from: user, text: 'hi again' }), HOOK)).status).toBe(200);
    expect((await t.knex('users').where({ id: user.id }).first()).bot_blocked_at).toBeNull();
  });

  it('/start with matching StartParamRoute calls its handler, otherwise greet with web_app button', async () => {
    t = await boot(false);
    const user: TgUser = { id: 2005, first_name: 'Shopper', language_code: 'uk' };

    expect((await postWebhook(t.http, updates.command('start', 'shop', user), HOOK)).status).toBe(200);
    expect(seen.routed).toEqual(['shop']);
    await waitFor(async () => sendsTo(t!, user.id).length === 1, 3000);
    expect(sendsTo(t, user.id)[0].body.text).toBe('shop opened');

    for (const param of [undefined, 'unknown']) {
      t.fakeBot.reset();
      expect((await postWebhook(t.http, updates.command('start', param, user), HOOK)).status).toBe(200);
      await waitFor(async () => sendsTo(t!, user.id).length === 1, 3000);
      const greet = sendsTo(t, user.id)[0].body;
      expect(greet.parse_mode).toBe('HTML');
      expect(JSON.stringify(markupOf(greet))).toContain(
        JSON.stringify({ web_app: { url: WEBAPP_URL } }).slice(1, -1),
      );
    }
    expect(seen.routed).toEqual(['shop']);
  });

  it('NotificationsService: 403 sets bot_blocked_at and returns bot_blocked; 429 retried once', async () => {
    t = await boot(false);
    const notifications = t.app.get(NotificationsService);
    await insertUsers(t.knex, [{ id: 2101 }, { id: 2102 }, { id: 2103 }, { id: 2104 }]);
    await t.knex('users').where({ id: 2104 }).update({ blocked_at: t.knex.fn.now() });

    t.fakeBot.respond('sendMessage', err(403, 'Forbidden: bot was blocked by the user'), { times: 1 });
    expect(await notifications.send(2101, () => 'hi')).toBe('bot_blocked');
    expect((await t.knex('users').where({ id: 2101 }).first()).bot_blocked_at).not.toBeNull();

    t.fakeBot.reset();
    expect(await notifications.send(2101, () => 'hi again')).toBe('skipped');
    expect(await notifications.send(2104, () => 'hi')).toBe('skipped');
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(0);

    t.fakeBot.respond('sendMessage', err(429, 'Too Many Requests: retry after 1', 1), { times: 1 });
    expect(await notifications.send(2102, (lang) => `lang=${lang}`)).toBe('sent');
    expect(sendsTo(t, 2102)).toHaveLength(2);

    t.fakeBot.reset();
    t.fakeBot.respond('sendMessage', err(429, 'Too Many Requests: retry after 1', 1), { times: 5 });
    expect(await notifications.send(2103, () => 'flood')).toBe('failed');
    expect(sendsTo(t, 2103)).toHaveLength(2);
  });

  it('broadcast snapshots recipients by audience languages and registered filter', async () => {
    t = await boot(false);
    const http = t.http;
    const asAdmin = (req: any) => req.set('Authorization', auth(t!, ADMIN));
    expect((await asAdmin(http.get('/api/me'))).status).toBe(200);

    await insertUsers(t.knex, [
      { id: 4001, language_code: 'uk' },
      { id: 4002, language_code: 'en' },
      { id: 4003, language: 'uk', language_code: 'en' },
      { id: 4004, language: 'en', language_code: 'uk' },
      { id: 4005, language_code: 'uk' },
      { id: 4006, language_code: 'uk' },
      { id: 4007, language_code: 'ru' },
    ]);
    await t.knex('users').where({ id: 4005 }).update({ blocked_at: t.knex.fn.now() });
    await t.knex('users').where({ id: 4006 }).update({ bot_blocked_at: t.knex.fn.now() });

    const uk = await createBroadcast(t, { languages: ['uk'] });
    expect(uk.status).toBe(201);
    expect(uk.body).toEqual({ id: expect.any(String), total: 2 });
    expect(await recipients(t.knex, uk.body.id)).toEqual([4001, 4003]);

    const audit = await t.knex('audit_events').where({ action: 'broadcast.create' });
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ total: 2, audience: { languages: ['uk'] } });

    const all = await createBroadcast(t, {});
    expect(all.body.total).toBe(6);
    expect(await recipients(t.knex, all.body.id)).toEqual([1001, 4001, 4002, 4003, 4004, 4007]);

    const vip = await createBroadcast(t, { filters: { vip: [4002, 4003, 4005] } });
    expect(await recipients(t.knex, vip.body.id)).toEqual([4002, 4003]);

    const enVip = await createBroadcast(t, { languages: ['en'], filters: { vip: [4002, 4003] } });
    expect(await recipients(t.knex, enVip.body.id)).toEqual([4002]);

    const unknown = await createBroadcast(t, { filters: { nope: 1 } });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'VALIDATION' });

    await insertUsers(t.knex, [{ id: 4008, language_code: 'uk' }]);
    expect(await recipients(t.knex, uk.body.id)).toEqual([4001, 4003]);
    expect((await t.knex('broadcasts').where({ id: uk.body.id }).first()).total).toBe(2);

    const estimate = await asAdmin(http.post('/api/admin/broadcasts/estimate')).send({
      audience: { languages: ['uk'] },
    });
    expect(estimate.body).toEqual({ total: 3 });

    const filters = await asAdmin(http.get('/api/admin/broadcasts/audience-filters'));
    expect(filters.body).toEqual(expect.arrayContaining([{ key: 'vip', label: 'VIP' }]));
  });

  it('broadcast worker: 25 per batch, 429 pauses, 403 marks failed + bot_blocked_at, 5xx retried 3 times', async () => {
    t = await boot(true);
    const knex = t.knex;
    expect((await t.http.get('/api/me').set('Authorization', auth(t, ADMIN))).status).toBe(200);
    await insertUsers(
      knex,
      Array.from({ length: 30 }, (_, i) => ({ id: 5001 + i, language_code: 'en' })),
    );

    const big = await createBroadcast(t, {});
    expect(big.status).toBe(201);
    const total: number = big.body.total;
    expect(total).toBe(31);
    const observed = new Set<number>();
    await waitFor(async () => {
      const b = await knex('broadcasts').where({ id: big.body.id }).first();
      observed.add(b.sent);
      return b.status === 'done';
    }, 30_000);
    expect(observed.has(25)).toBe(true);
    for (const v of observed) expect([0, 25, total]).toContain(v);
    expect(chatIds(t).sort((a, b) => a - b)).toEqual(await recipients(knex, big.body.id));
    expect(t.fakeBot.callsOf('sendMessage')[0].body).toMatchObject({
      text: 'Hello <b>all</b>',
      parse_mode: 'HTML',
    });
    expect(await knex('broadcasts').where({ id: big.body.id }).first()).toMatchObject({
      status: 'done',
      sent: total,
      failed: 0,
    });

    t.fakeBot.reset();
    t.fakeBot.respond('sendMessage', err(429, 'Too Many Requests: retry after 1', 1), { times: 1 });
    const started = Date.now();
    const flood = await createBroadcast(t, { filters: { vip: [5001, 5002, 5003] } });
    await waitDone(knex, flood.body.id);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect((await deliveries(knex, flood.body.id)).every((d) => d.status === 'sent')).toBe(true);
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(4);

    t.fakeBot.reset();
    const blockedIds = [5004, 5005, 5006, 5007, 5008];
    const armed = afterNthCall(t, 'sendMessage', 2, () =>
      t!.fakeBot.respond('sendMessage', err(403, 'Forbidden: bot was blocked by the user'), { times: 1 }),
    );
    const blocked = await createBroadcast(t, { filters: { vip: blockedIds } });
    await armed;
    const doneBlocked = await waitDone(knex, blocked.body.id);
    const order = chatIds(t);
    expect(order).toHaveLength(5);
    const victim = order[2];
    const rows = await deliveries(knex, blocked.body.id);
    const status = Object.fromEntries(rows.map((d) => [d.user_id, d.status]));
    expect(status[victim]).toBe('failed');
    for (const id of blockedIds.filter((x) => x !== victim)) expect(status[id]).toBe('sent');
    expect(order.slice(3).every((id) => status[id] === 'sent')).toBe(true);
    expect((await knex('users').where({ id: victim }).first()).bot_blocked_at).not.toBeNull();
    for (const id of order.slice(3)) {
      expect((await knex('users').where({ id }).first()).bot_blocked_at).toBeNull();
    }
    expect(doneBlocked).toMatchObject({ sent: 4, failed: 1 });

    t.fakeBot.reset();
    t.fakeBot.respond('sendMessage', err(500, 'Internal Server Error'), { times: 10 });
    const flaky = await createBroadcast(t, { filters: { vip: [5010] } });
    await waitDone(knex, flaky.body.id);
    const [only] = await deliveries(knex, flaky.body.id);
    expect(only).toMatchObject({ status: 'failed', attempts: 3 });
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(3);
  });

  it('broadcast cancel marks rest skipped', async () => {
    t = await boot(false);
    expect((await t.http.get('/api/me').set('Authorization', auth(t, ADMIN))).status).toBe(200);
    await insertUsers(t.knex, [{ id: 6001 }, { id: 6002 }, { id: 6003 }]);

    const created = await createBroadcast(t, {});
    const id: string = created.body.id;
    await t.knex('broadcast_deliveries').where({ broadcast_id: id, user_id: 6001 }).update({
      status: 'sent',
      sent_at: t.knex.fn.now(),
    });

    const cancel = await t.http
      .post(`/api/admin/broadcasts/${id}/cancel`)
      .set('Authorization', auth(t, ADMIN));
    expect(cancel.status).toBeLessThan(300);

    expect((await t.knex('broadcasts').where({ id }).first()).status).toBe('canceled');
    const byUser = Object.fromEntries(
      (await deliveries(t.knex, id)).map((d) => [d.user_id, d.status]),
    );
    expect(byUser).toEqual({ 1001: 'skipped', 6001: 'sent', 6002: 'skipped', 6003: 'skipped' });
    expect(await t.knex('audit_events').where({ action: 'broadcast.cancel' })).toHaveLength(1);
  });

  it('broadcast resumes after restart without duplicates', async () => {
    const db = await createTestDatabase({ migrations: MIGRATIONS });
    const knexA = createKnex({ client: 'pg', connection: db.url, pool: { min: 0, max: 4 } });
    const knexB = createKnex({ client: 'pg', connection: db.url, pool: { min: 0, max: 4 } });
    let a: TestApp | undefined;
    let b: TestApp | undefined;
    try {
      a = await bootOn(knexA, false);
      expect((await a.http.get('/api/me').set('Authorization', auth(a, ADMIN))).status).toBe(200);
      await insertUsers(db.knex, Array.from({ length: 12 }, (_, i) => ({ id: 7001 + i })));
      const created = await createBroadcast(a, {});
      const id: string = created.body.id;
      const all = await recipients(db.knex, id);
      const preSent = all.slice(0, 3);
      await db.knex('broadcast_deliveries')
        .where({ broadcast_id: id })
        .whereIn('user_id', preSent)
        .update({ status: 'sent', sent_at: db.knex.fn.now(), attempts: 1 });
      await db.knex('broadcasts').where({ id }).update({ status: 'running', started_at: db.knex.fn.now() });
      await a.close();
      a = undefined;

      b = await bootOn(knexB, true);
      await waitDone(db.knex, id);
      const sentByB = chatIds(b).sort((x, y) => x - y);
      expect(sentByB).toEqual(all.filter((u) => !preSent.includes(u)));
      expect(new Set(sentByB).size).toBe(sentByB.length);
      expect((await deliveries(db.knex, id)).every((d) => d.status === 'sent')).toBe(true);
    } finally {
      await a?.close();
      await b?.close();
      await knexA.destroy();
      await knexB.destroy();
      await db.drop();
    }
  });

  it('two workers in parallel deliver exactly one message per recipient', async () => {
    const db = await createTestDatabase({ migrations: MIGRATIONS });
    const knexes = [0, 1, 2].map(() =>
      createKnex({ client: 'pg', connection: db.url, pool: { min: 0, max: 4 } }),
    );
    const apps: TestApp[] = [];
    try {
      const a = await bootOn(knexes[0], false);
      apps.push(a);
      expect((await a.http.get('/api/me').set('Authorization', auth(a, ADMIN))).status).toBe(200);
      await insertUsers(db.knex, Array.from({ length: 60 }, (_, i) => ({ id: 8001 + i })));
      const created = await createBroadcast(a, {});
      const id: string = created.body.id;
      const all = await recipients(db.knex, id);
      expect(all).toHaveLength(61);
      await apps.pop()!.close();

      const [w1, w2] = await Promise.all([bootOn(knexes[1], true), bootOn(knexes[2], true)]);
      apps.push(w1, w2);
      await waitDone(db.knex, id, 60_000);

      const sent = [...chatIds(w1), ...chatIds(w2)].sort((x, y) => x - y);
      expect(sent).toEqual(all);
      expect((await db.knex('broadcasts').where({ id }).first()).sent).toBe(61);
    } finally {
      for (const app of apps) await app.close();
      for (const k of knexes) await k.destroy();
      await db.drop();
    }
  });

  it('tma-bot setup: calls setWebhook then profile methods; exit 1 when setWebhook fails, exit 2 when profile fails', async () => {
    const bin = join(
      dirname(require.resolve('@dmytro-rudenko/tma-nest-bot/package.json')),
      'dist/bin/tma-bot.js',
    );
    const dir = mkdtempSync(join(tmpdir(), 'tma-bot-setup-'));
    const profilePath = join(dir, 'profile.json');
    writeFileSync(
      profilePath,
      JSON.stringify({
        menuButtonText: 'Відкрити',
        en: {
          short_description: 'Short en',
          description: 'Long en',
          commands: [{ command: 'start', description: 'Start' }],
        },
        uk: {
          short_description: 'Коротко',
          description: 'Довго',
          commands: [{ command: 'start', description: 'Почати' }],
        },
      }),
    );
    const fake = await startFakeBotApi();
    const run = () =>
      new Promise<{ code: number; output: string }>((resolve) => {
        execFile(
          process.execPath,
          [bin, 'setup'],
          {
            env: {
              ...process.env,
              BOT_TOKEN,
              WEBAPP_URL,
              WEBHOOK_PATH_TOKEN: PATH_TOKEN,
              WEBHOOK_SECRET: SECRET,
              BOT_PROFILE: profilePath,
              BOT_API_ROOT: fake.url,
            },
          },
          (error, stdout, stderr) => {
            const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
            resolve({ code, output: stdout + stderr });
          },
        );
      });

    try {
      const ok = await run();
      expect(ok.code).toBe(0);
      expect(fake.calls[0].method).toBe('setWebhook');
      expect(fake.calls[0].body).toMatchObject({
        url: `${WEBAPP_URL}/bot/${PATH_TOKEN}`,
        secret_token: SECRET,
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      });
      expect(fake.callsOf('setWebhook')).toHaveLength(1);
      expect(fake.callsOf('setChatMenuButton')).toHaveLength(1);
      expect(fake.callsOf('setChatMenuButton')[0].body.menu_button).toMatchObject({
        type: 'web_app',
        text: 'Відкрити',
        web_app: { url: WEBAPP_URL },
      });
      const byLang = (method: string) =>
        Object.fromEntries(
          fake.callsOf(method).map((c) => [c.body.language_code ?? 'default', c.body]),
        );
      expect(byLang('setMyDescription')).toEqual({
        default: expect.objectContaining({ description: 'Long en' }),
        uk: expect.objectContaining({ description: 'Довго' }),
      });
      expect(byLang('setMyShortDescription')).toEqual({
        default: expect.objectContaining({ short_description: 'Short en' }),
        uk: expect.objectContaining({ short_description: 'Коротко' }),
      });
      expect(byLang('setMyCommands')).toEqual({
        default: expect.objectContaining({ commands: [{ command: 'start', description: 'Start' }] }),
        uk: expect.objectContaining({ commands: [{ command: 'start', description: 'Почати' }] }),
      });

      fake.reset();
      fake.badRequest('setWebhook', 'Bad Request: bad webhook: HTTPS url must be provided');
      const noHook = await run();
      expect(noHook.code).toBe(1);
      expect(fake.callsOf('setChatMenuButton')).toHaveLength(0);
      expect(fake.callsOf('setMyCommands')).toHaveLength(0);

      fake.reset();
      fake.badRequest('setMyCommands', 'Bad Request: invalid command');
      const noProfile = await run();
      expect(noProfile.code).toBe(2);
      expect(fake.callsOf('setWebhook')).toHaveLength(1);
      expect(fake.callsOf('setMyDescription')).toHaveLength(2);
      expect(fake.callsOf('setChatMenuButton')).toHaveLength(1);
    } finally {
      await fake.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
