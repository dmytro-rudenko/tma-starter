import { Knex } from 'knex';
import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { createTestApp } from '@dmytro-rudenko/tma-testing';
import { NotificationsService, TmaBotModule, migrations as botMigrations } from './index';
import { guard } from './notifications.service';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const BOT_TOKEN = '123456:NOTIFY-TEST';

let t: TestApp;
let notifications: NotificationsService;

beforeAll(async () => {
  t = await createTestApp({
    botToken: BOT_TOKEN,
    migrations: composeMigrations(coreMigrations, botMigrations),
    imports: (ctx) => [
      TmaCoreModule.forRoot({
        knex: ctx.knex,
        botToken: ctx.botToken,
        adminUserIds: [],
        runWorker: false,
        throttle: { ttlMs: 60_000, limit: 100_000 },
      }),
      TmaBotModule.forRoot({
        botToken: ctx.botToken,
        botUsername: 'notify_test_bot',
        webappUrl: 'https://notify.example.com',
        webhookPathToken: 'path-token-notify-0123',
        webhookSecret: 'secret-notify-0123456789',
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
    ],
  });
  notifications = t.app.get(NotificationsService);
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  t.fakeBot.reset();
});

async function insertUser(
  knex: Knex,
  row: { id: number; language?: string | null; language_code?: string | null },
): Promise<void> {
  await knex('users').insert({ first_name: `User ${row.id}`, ...row });
}

async function botBlockedAt(id: number): Promise<Date | null> {
  return (await t.knex('users').where({ id }).first()).bot_blocked_at;
}

const sends = (chatId: number) =>
  t.fakeBot.callsOf('sendMessage').filter((c) => Number(c.body.chat_id) === chatId);

function markupOf(body: any): any {
  return typeof body.reply_markup === 'string' ? JSON.parse(body.reply_markup) : body.reply_markup;
}

describe('NotificationsService.send', () => {
  it('sends HTML text and markup built for the recipient language → sent', async () => {
    await insertUser(t.knex, { id: 3001, language_code: 'uk' });
    const markup = (lang: 'uk' | 'en') => ({
      inline_keyboard: [[{ text: `open-${lang}`, url: 'https://t.me/notify_test_bot?startapp=x' }]],
    });

    expect(await notifications.send(3001, (lang) => `<b>hi ${lang}</b>`, { markup })).toBe('sent');

    const calls = sends(3001);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.text).toBe('<b>hi uk</b>');
    expect(calls[0].body.parse_mode).toBe('HTML');
    expect(markupOf(calls[0].body)).toEqual({
      inline_keyboard: [[{ text: 'open-uk', url: 'https://t.me/notify_test_bot?startapp=x' }]],
    });
  });

  it('users.language wins over language_code; anything but uk is en', async () => {
    await insertUser(t.knex, { id: 3011, language: 'uk', language_code: 'en' });
    await insertUser(t.knex, { id: 3012, language: 'en', language_code: 'uk' });
    await insertUser(t.knex, { id: 3013, language: null, language_code: 'de' });
    await insertUser(t.knex, { id: 3014, language: null, language_code: null });

    for (const id of [3011, 3012, 3013, 3014]) {
      expect(await notifications.send(id, (lang) => `lang=${lang}`)).toBe('sent');
    }

    expect([3011, 3012, 3013, 3014].map((id) => sends(id).map((c) => c.body.text))).toEqual([
      ['lang=uk'],
      ['lang=en'],
      ['lang=en'],
      ['lang=en'],
    ]);
  });

  it('skips blocked_at, bot_blocked_at and unknown users without calling Bot API', async () => {
    await insertUser(t.knex, { id: 3021 });
    await insertUser(t.knex, { id: 3022 });
    await t.knex('users').where({ id: 3021 }).update({ blocked_at: t.knex.fn.now() });
    await t.knex('users').where({ id: 3022 }).update({ bot_blocked_at: t.knex.fn.now() });

    expect(await notifications.send(3021, () => 'x')).toBe('skipped');
    expect(await notifications.send(3022, () => 'x')).toBe('skipped');
    expect(await notifications.send(3029, () => 'x')).toBe('skipped');
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(0);
  });

  it.each([
    [3031, 'Forbidden: bot was blocked by the user'],
    [3032, 'Forbidden: user is deactivated'],
  ])('403 for %i (%s) sets users.bot_blocked_at → bot_blocked', async (id, description) => {
    await insertUser(t.knex, { id });
    t.fakeBot.respond('sendMessage', { ok: false, error_code: 403, description });

    expect(await botBlockedAt(id)).toBeNull();
    expect(await notifications.send(id, () => 'hi')).toBe('bot_blocked');
    expect(await botBlockedAt(id)).toBeInstanceOf(Date);
    expect(sends(id)).toHaveLength(1);

    t.fakeBot.reset();
    expect(await notifications.send(id, () => 'again')).toBe('skipped');
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(0);
  });

  it('403 leaves other users untouched', async () => {
    await insertUser(t.knex, { id: 3041 });
    await insertUser(t.knex, { id: 3042 });
    t.fakeBot.blockedByUser('sendMessage');

    expect(await notifications.send(3041, () => 'hi')).toBe('bot_blocked');
    expect(await botBlockedAt(3041)).toBeInstanceOf(Date);
    expect(await botBlockedAt(3042)).toBeNull();
  });

  it('429 waits retry_after, retries once and returns sent', async () => {
    await insertUser(t.knex, { id: 3051 });
    t.fakeBot.respond(
      'sendMessage',
      {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 1',
        parameters: { retry_after: 1 },
      },
      { times: 1 },
    );

    const started = Date.now();
    expect(await notifications.send(3051, () => 'flood')).toBe('sent');
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(sends(3051).map((c) => c.body.text)).toEqual(['flood', 'flood']);
    expect(await botBlockedAt(3051)).toBeNull();
  });

  it('429 on the retry too → failed after exactly two calls', async () => {
    await insertUser(t.knex, { id: 3061 });
    t.fakeBot.tooManyRequests('sendMessage', 1);

    expect(await notifications.send(3061, () => 'flood')).toBe('failed');
    expect(sends(3061)).toHaveLength(2);
    expect(await botBlockedAt(3061)).toBeNull();
  });

  it('403 on the 429 retry still marks bot_blocked', async () => {
    await insertUser(t.knex, { id: 3071 });
    t.fakeBot.respond(
      'sendMessage',
      {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests: retry after 1',
        parameters: { retry_after: 1 },
      },
      { times: 1 },
    );
    t.fakeBot.respond(
      'sendMessage',
      { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
      { times: 1 },
    );

    expect(await notifications.send(3071, () => 'x')).toBe('bot_blocked');
    expect(sends(3071)).toHaveLength(2);
    expect(await botBlockedAt(3071)).toBeInstanceOf(Date);
  });

  it.each([
    [3081, 400, 'Bad Request: chat not found'],
    [3082, 500, 'Internal Server Error'],
  ])('%i: %i is failed after one call, bot_blocked_at stays null', async (id, code, description) => {
    await insertUser(t.knex, { id });
    t.fakeBot.respond('sendMessage', { ok: false, error_code: code, description });

    expect(await notifications.send(id, () => 'x')).toBe('failed');
    expect(sends(id)).toHaveLength(1);
    expect(await botBlockedAt(id)).toBeNull();
  });

  it('never throws: a throwing text builder → failed, nothing sent', async () => {
    await insertUser(t.knex, { id: 3091 });

    await expect(
      notifications.send(3091, () => {
        throw new Error('copy broke');
      }),
    ).resolves.toBe('failed');
    expect(t.fakeBot.callsOf('sendMessage')).toHaveLength(0);
  });
});

describe('guard', () => {
  it('resolves to the function result', async () => {
    await expect(guard('ok', async () => 42)).resolves.toBe(42);
  });

  it('swallows a rejection and resolves to undefined', async () => {
    await expect(
      guard('boom', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();
  });

  it('swallows a synchronous throw', async () => {
    await expect(
      guard('sync', () => {
        throw new Error('sync');
      }),
    ).resolves.toBeUndefined();
  });
});
