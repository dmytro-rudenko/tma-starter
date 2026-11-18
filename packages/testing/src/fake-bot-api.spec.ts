import { FakeBotApi, startFakeBotApi } from './fake-bot-api';

const BOT_TOKEN = '123456:FAKE-BOT-SPEC';

async function call(fake: FakeBotApi, method: string, body: object = {}) {
  const res = await fetch(`${fake.url}/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('startFakeBotApi', () => {
  let fake: FakeBotApi;

  beforeEach(async () => {
    fake = await startFakeBotApi();
  });

  afterEach(async () => {
    await fake.close();
  });

  it('listens on an ephemeral port by default', async () => {
    const other = await startFakeBotApi();
    try {
      const port = Number(new URL(fake.url).port);
      expect(port).toBeGreaterThan(0);
      expect(other.url).not.toBe(fake.url);
    } finally {
      await other.close();
    }
  });

  it('records every call with its method and JSON body, in order', async () => {
    await call(fake, 'sendMessage', { chat_id: 1, text: 'a' });
    await call(fake, 'setMyCommands', { commands: [{ command: 'start', description: 'Start' }] });
    await call(fake, 'sendMessage', { chat_id: 2, text: 'b' });

    expect(fake.calls).toEqual([
      { method: 'sendMessage', body: { chat_id: 1, text: 'a' } },
      { method: 'setMyCommands', body: { commands: [{ command: 'start', description: 'Start' }] } },
      { method: 'sendMessage', body: { chat_id: 2, text: 'b' } },
    ]);
    expect(fake.callsOf('sendMessage')).toEqual([
      { method: 'sendMessage', body: { chat_id: 1, text: 'a' } },
      { method: 'sendMessage', body: { chat_id: 2, text: 'b' } },
    ]);
    expect(fake.callsOf('setWebhook')).toEqual([]);
  });

  describe('default replies', () => {
    it.each([
      'answerPreCheckoutQuery',
      'refundStarPayment',
      'editUserStarSubscription',
      'setWebhook',
      'setChatMenuButton',
      'setMyCommands',
      'setMyDescription',
      'setMyShortDescription',
    ])('%s answers 200 { ok: true, result: true }', async (method) => {
      expect(await call(fake, method)).toEqual({ status: 200, json: { ok: true, result: true } });
    });

    it('sendMessage answers with a numeric message_id', async () => {
      const res = await call(fake, 'sendMessage', { chat_id: 1, text: 'hi' });

      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      expect(typeof res.json.result.message_id).toBe('number');
    });

    it('createInvoiceLink answers https://t.me/$fake/<n> counting from 1', async () => {
      expect(await call(fake, 'createInvoiceLink', { title: 'a' })).toEqual({
        status: 200,
        json: { ok: true, result: 'https://t.me/$fake/1' },
      });
      expect((await call(fake, 'createInvoiceLink', { title: 'b' })).json.result).toBe(
        'https://t.me/$fake/2',
      );
    });

    it('savePreparedInlineMessage answers { id: "prep-<n>" } counting from 1', async () => {
      const first = await call(fake, 'savePreparedInlineMessage', { user_id: 1 });
      const second = await call(fake, 'savePreparedInlineMessage', { user_id: 1 });

      expect(first.status).toBe(200);
      expect(first.json.ok).toBe(true);
      expect(first.json.result).toMatchObject({ id: 'prep-1' });
      expect(second.json.result).toMatchObject({ id: 'prep-2' });
    });

    it('getStarTransactions answers { transactions: [] }', async () => {
      expect(await call(fake, 'getStarTransactions')).toEqual({
        status: 200,
        json: { ok: true, result: { transactions: [] } },
      });
    });
  });

  describe('respond', () => {
    it('without times replaces the reply until reset', async () => {
      fake.respond('getStarTransactions', { ok: true, result: { transactions: [{ id: 'tx' }] } });

      for (let i = 0; i < 4; i++) {
        expect(await call(fake, 'getStarTransactions')).toEqual({
          status: 200,
          json: { ok: true, result: { transactions: [{ id: 'tx' }] } },
        });
      }
    });

    it('with times replies that many times, then falls back to the default', async () => {
      fake.respond('sendMessage', { ok: true, result: { message_id: 777 } }, { times: 2 });

      const replies = [];
      for (let i = 0; i < 3; i++) replies.push(await call(fake, 'sendMessage', { chat_id: i }));

      expect(replies[0]).toEqual({ status: 200, json: { ok: true, result: { message_id: 777 } } });
      expect(replies[1]).toEqual({ status: 200, json: { ok: true, result: { message_id: 777 } } });
      expect(replies[2].status).toBe(200);
      expect(replies[2].json.result.message_id).not.toBe(777);
    });

    it('an ok:false reply is sent with HTTP status equal to error_code and its body verbatim', async () => {
      fake.respond(
        'sendMessage',
        {
          ok: false,
          error_code: 409,
          description: 'Conflict: terminated by other request',
          parameters: { migrate_to_chat_id: -100123 },
        },
        { times: 1 },
      );

      expect(await call(fake, 'sendMessage', { chat_id: 1 })).toEqual({
        status: 409,
        json: {
          ok: false,
          error_code: 409,
          description: 'Conflict: terminated by other request',
          parameters: { migrate_to_chat_id: -100123 },
        },
      });
      expect((await call(fake, 'sendMessage', { chat_id: 1 })).status).toBe(200);
    });

    it('affects only the given method', async () => {
      fake.respond('setWebhook', { ok: false, error_code: 400, description: 'Bad Request: x' });

      expect(await call(fake, 'setMyCommands')).toEqual({
        status: 200,
        json: { ok: true, result: true },
      });
    });

    it('records the call even when the reply is an error', async () => {
      fake.respond('setWebhook', { ok: false, error_code: 400, description: 'Bad Request: x' });

      await call(fake, 'setWebhook', { url: 'https://example.test/hook' });

      expect(fake.callsOf('setWebhook')).toEqual([
        { method: 'setWebhook', body: { url: 'https://example.test/hook' } },
      ]);
    });
  });

  describe('scenarios', () => {
    it('blockedByUser answers 403 on every call until reset', async () => {
      fake.blockedByUser('sendMessage');

      for (let i = 0; i < 3; i++) {
        expect(await call(fake, 'sendMessage', { chat_id: 5, text: 'x' })).toEqual({
          status: 403,
          json: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' },
        });
      }
      expect(fake.callsOf('sendMessage')).toHaveLength(3);

      fake.reset();
      expect((await call(fake, 'sendMessage', { chat_id: 5, text: 'x' })).status).toBe(200);
    });

    it('tooManyRequests answers 429 with parameters.retry_after on every call until reset', async () => {
      fake.tooManyRequests('sendMessage', 7);

      for (let i = 0; i < 2; i++) {
        expect(await call(fake, 'sendMessage', { chat_id: 5, text: 'x' })).toEqual({
          status: 429,
          json: {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 7',
            parameters: { retry_after: 7 },
          },
        });
      }

      fake.reset();
      expect((await call(fake, 'sendMessage', { chat_id: 5, text: 'x' })).status).toBe(200);
    });

    it('badRequest answers 400 with the given description on every call until reset', async () => {
      fake.badRequest('setWebhook', 'Bad Request: bad webhook: HTTPS url must be provided');

      for (let i = 0; i < 2; i++) {
        expect(await call(fake, 'setWebhook', { url: 'http://x' })).toEqual({
          status: 400,
          json: {
            ok: false,
            error_code: 400,
            description: 'Bad Request: bad webhook: HTTPS url must be provided',
          },
        });
      }

      fake.reset();
      expect(await call(fake, 'setWebhook', { url: 'https://x' })).toEqual({
        status: 200,
        json: { ok: true, result: true },
      });
    });

    it('affect only the given method', async () => {
      fake.blockedByUser('sendMessage');

      expect(await call(fake, 'answerPreCheckoutQuery')).toEqual({
        status: 200,
        json: { ok: true, result: true },
      });
    });
  });

  describe('reset', () => {
    it('clears calls and respond overrides', async () => {
      fake.respond('getStarTransactions', { ok: true, result: { transactions: [{ id: 'tx' }] } });
      await call(fake, 'getStarTransactions');

      fake.reset();

      expect(fake.calls).toEqual([]);
      expect((await call(fake, 'getStarTransactions')).json).toEqual({
        ok: true,
        result: { transactions: [] },
      });
      expect(fake.calls).toEqual([{ method: 'getStarTransactions', body: {} }]);
    });
  });

  it('close stops the server', async () => {
    const other = await startFakeBotApi();
    await other.close();

    await expect(call(other, 'sendMessage')).rejects.toThrow();
  });
});
