import { createHmac, timingSafeEqual } from 'crypto';
import type { Knex } from 'knex';
import { knex as createKnex } from 'knex';
import { createTestDatabase, devUrl, startFakeBotApi } from '@dmytro-rudenko/tma-testing';

jest.setTimeout(60_000);

const BOT_TOKEN = '123456:TESTING-TEST';

const probeMigrations: Knex.MigrationSource<string> = {
  getMigrations: async () => ['tma_testing_001_probe'],
  getMigrationName: (name) => name,
  getMigration: async () => ({
    up: (knex: Knex) =>
      knex.schema.createTable('probe', (t) => {
        t.increments('id');
        t.text('label').notNullable();
      }),
    down: (knex: Knex) => knex.schema.dropTable('probe'),
  }),
};

function adminUrl(): string {
  return process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
}

const dbName = (url: string) => new URL(url).pathname.slice(1);

async function callBot(url: string, method: string, body: object = {}) {
  const res = await fetch(`${url}/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('tma-testing acceptance', () => {
  it('FakeBotApi.respond with times', async () => {
    const fake = await startFakeBotApi();
    try {
      fake.respond('sendMessage', { ok: true, result: { message_id: 777 } }, { times: 2 });

      const first = await callBot(fake.url, 'sendMessage', { chat_id: 1, text: 'a' });
      const second = await callBot(fake.url, 'sendMessage', { chat_id: 2, text: 'b' });
      const third = await callBot(fake.url, 'sendMessage', { chat_id: 3, text: 'c' });
      expect(first).toEqual({ status: 200, json: { ok: true, result: { message_id: 777 } } });
      expect(second.json.result).toEqual({ message_id: 777 });
      expect(third.status).toBe(200);
      expect(third.json.ok).toBe(true);
      expect(third.json.result.message_id).not.toBe(777);

      expect(fake.callsOf('sendMessage').map((c) => c.body)).toEqual([
        { chat_id: 1, text: 'a' },
        { chat_id: 2, text: 'b' },
        { chat_id: 3, text: 'c' },
      ]);

      fake.respond(
        'createInvoiceLink',
        { ok: false, error_code: 400, description: 'Bad Request: CURRENCY_INVALID' },
        { times: 1 },
      );
      const failed = await callBot(fake.url, 'createInvoiceLink', { title: 'x' });
      expect(failed).toEqual({
        status: 400,
        json: { ok: false, error_code: 400, description: 'Bad Request: CURRENCY_INVALID' },
      });
      const fallback = await callBot(fake.url, 'createInvoiceLink', { title: 'x' });
      expect(fallback.status).toBe(200);
      expect(typeof fallback.json.result).toBe('string');

      fake.respond('getStarTransactions', { ok: true, result: { transactions: [{ id: 'tx' }] } });
      for (let i = 0; i < 3; i++) {
        expect((await callBot(fake.url, 'getStarTransactions')).json.result).toEqual({
          transactions: [{ id: 'tx' }],
        });
      }

      expect(fake.calls.map((c) => c.method)).toEqual([
        'sendMessage',
        'sendMessage',
        'sendMessage',
        'createInvoiceLink',
        'createInvoiceLink',
        'getStarTransactions',
        'getStarTransactions',
        'getStarTransactions',
      ]);

      fake.reset();
      expect(fake.calls).toEqual([]);
      const afterReset = await callBot(fake.url, 'getStarTransactions');
      expect(afterReset.json.result).not.toEqual({ transactions: [{ id: 'tx' }] });

      for (const method of [
        'answerPreCheckoutQuery',
        'refundStarPayment',
        'editUserStarSubscription',
        'setWebhook',
        'setChatMenuButton',
        'setMyCommands',
        'setMyDescription',
        'setMyShortDescription',
        'savePreparedInlineMessage',
      ]) {
        const res = await callBot(fake.url, method);
        expect(res.status).toBe(200);
        expect(res.json.ok).toBe(true);
      }
    } finally {
      await fake.close();
    }
  });

  it('blockedByUser / tooManyRequests replies', async () => {
    const fake = await startFakeBotApi();
    try {
      fake.blockedByUser('sendMessage');
      for (let i = 0; i < 2; i++) {
        const res = await callBot(fake.url, 'sendMessage', { chat_id: 5, text: 'x' });
        expect(res.status).toBe(403);
        expect(res.json).toMatchObject({
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        });
      }

      fake.reset();
      fake.tooManyRequests('sendMessage', 7);
      const flood = await callBot(fake.url, 'sendMessage', { chat_id: 5, text: 'x' });
      expect(flood.status).toBe(429);
      expect(flood.json).toMatchObject({
        ok: false,
        error_code: 429,
        parameters: { retry_after: 7 },
      });
      expect(flood.json.description).toMatch(/Too Many Requests/);

      fake.reset();
      fake.badRequest('setWebhook', 'Bad Request: bad webhook');
      const bad = await callBot(fake.url, 'setWebhook', { url: 'http://x' });
      expect(bad).toEqual({
        status: 400,
        json: { ok: false, error_code: 400, description: 'Bad Request: bad webhook' },
      });
      expect(fake.callsOf('setWebhook')).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it('createTestDatabase clones template db and drop removes it', async () => {
    const admin = createKnex({ client: 'pg', connection: adminUrl(), pool: { min: 0, max: 1 } });
    try {
      const a = await createTestDatabase({ migrations: probeMigrations });
      const b = await createTestDatabase({ migrations: probeMigrations });
      const nameA = dbName(a.url);
      const nameB = dbName(b.url);
      expect(nameA).toMatch(/^tma_t_/);
      expect(nameB).toMatch(/^tma_t_/);
      expect(nameA).not.toBe(nameB);

      const templates = await admin
        .select('datname')
        .from('pg_database')
        .where('datname', 'like', 'tma_tpl_%');
      expect(templates.length).toBeGreaterThanOrEqual(1);

      await a.knex('probe').insert({ label: 'only in a' });
      expect(await a.knex('probe').select('label')).toEqual([{ label: 'only in a' }]);
      expect(await b.knex('probe').select('label')).toEqual([]);

      await a.drop();
      await b.drop();
      const left = await admin
        .select('datname')
        .from('pg_database')
        .whereIn('datname', [nameA, nameB]);
      expect(left).toEqual([]);
    } finally {
      await admin.destroy();
    }
  });

  it('devUrl produces hash that validateInitData accepts', () => {
    const user = { id: 42, first_name: 'Olia', language_code: 'uk' };
    const url = devUrl({ baseUrl: 'http://localhost:5173', user, botToken: BOT_TOKEN, startParam: 'shop' });

    expect(url.startsWith('http://localhost:5173/#tgWebAppData=')).toBe(true);
    const hash = new URLSearchParams(new URL(url).hash.slice(1));
    expect(hash.get('tgWebAppVersion')).toBe('8.0');
    expect(hash.get('tgWebAppPlatform')).toBe('tdesktop');

    const raw = hash.get('tgWebAppData')!;
    const data = new URLSearchParams(raw);
    expect(data.get('start_param')).toBe('shop');
    expect(JSON.parse(data.get('user')!)).toMatchObject({ id: 42, first_name: 'Olia' });
    expect(Number(data.get('auth_date'))).toBeGreaterThan(Math.floor(Date.now() / 1000) - 60);

    const received = data.get('hash')!;
    expect(received).toMatch(/^[0-9a-f]{64}$/);
    const checkString = [...data.entries()]
      .filter(([k]) => k !== 'hash')
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');
    const signWith = (token: string) => {
      const secret = createHmac('sha256', 'WebAppData').update(token).digest();
      return createHmac('sha256', secret).update(checkString).digest('hex');
    };
    expect(signWith(BOT_TOKEN)).toBe(received);
    expect(timingSafeEqual(Buffer.from(signWith(BOT_TOKEN), 'hex'), Buffer.from(received, 'hex'))).toBe(true);
    expect(signWith('999999:OTHER')).not.toBe(received);
  });
});
