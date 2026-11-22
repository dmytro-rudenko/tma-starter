import { createTestApp } from '@dmytro-rudenko/tma-testing';
// tma:shop:start
import { postWebhook, updates } from '@dmytro-rudenko/tma-testing';
import { BotService } from '@dmytro-rudenko/tma-nest-bot';
// tma:shop:end
import { appImports } from '../src/app.module';
import { migrations } from '../src/database/migrate';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string; language_code?: string };

const BOT_TOKEN = '123456:APP-TEST';
const PATH_TOKEN = 'app-path-token-0123';
const SECRET = 'app-secret-0123456789';
const ADMIN: TgUser = { id: 1001, first_name: 'Admin', language_code: 'en' };
const OLENA: TgUser = { id: 2002, first_name: 'Олена', language_code: 'uk' };
const JOHN: TgUser = { id: 3003, first_name: 'John', language_code: 'en' };
const HANS: TgUser = { id: 4004, first_name: 'Hans', language_code: 'de' };

let t: TestApp;

const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const get = (path: string, u?: TgUser) => {
  const req = t.http.get(path);
  return u ? req.set('Authorization', auth(u)) : req;
};

beforeAll(async () => {
  t = await createTestApp({
    botToken: BOT_TOKEN,
    migrations,
    imports: (ctx) =>
      appImports({
        knex: ctx.knex,
        botToken: ctx.botToken,
        apiRoot: ctx.apiRoot,
        env: {
          BOT_TOKEN: ctx.botToken,
          BOT_USERNAME: 'smoke_app_bot',
          WEBAPP_URL: 'https://smoke.example.com',
          WEBHOOK_SECRET: SECRET,
          WEBHOOK_PATH_TOKEN: PATH_TOKEN,
          DATABASE_URL: ctx.databaseUrl,
          BOT_API_ROOT: ctx.apiRoot,
          RUN_WORKER: 'false',
          API_RATE_LIMIT: '100000',
          ADMIN_USER_IDS: String(ADMIN.id),
        },
      }),
  });
});

afterAll(async () => {
  await t?.close();
});

describe('health', () => {
  it('GET /api/health answers 200 without auth', async () => {
    const res = await get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('me', () => {
  it('GET /api/me without initData answers 401 UNAUTHORIZED', async () => {
    const res = await get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('GET /api/me returns the signed-in user', async () => {
    const res = await get('/api/me', JOHN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: JOHN.id, firstName: 'John', isAdmin: false });
  });

  it('GET /api/me marks an ADMIN_USER_IDS user as an env admin', async () => {
    const res = await get('/api/me', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ADMIN.id, isAdmin: true, adminSource: 'env' });
  });
});

describe('example', () => {
  it('GET /api/example/hello greets in Ukrainian for language_code uk', async () => {
    const res = await get('/api/example/hello', OLENA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ greeting: 'Привіт, Олена!' });
  });

  it('GET /api/example/hello greets in English for language_code en', async () => {
    const res = await get('/api/example/hello', JOHN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ greeting: 'Hello, John!' });
  });

  it('GET /api/example/hello falls back to English for any other language', async () => {
    const res = await get('/api/example/hello', HANS);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ greeting: 'Hello, Hans!' });
  });

  it('GET /api/example/hello requires initData', async () => {
    const res = await get('/api/example/hello');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });
});

describe('admin', () => {
  it('GET /api/admin/users answers 403 NOT_ADMIN for a non-admin', async () => {
    const res = await get('/api/admin/users', JOHN);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'NOT_ADMIN' });
  });

  it('GET /api/admin/users answers 200 for an env admin', async () => {
    const res = await get('/api/admin/users', ADMIN);
    expect(res.status).toBe(200);
  });
});

// tma:shop:start
describe('shop: premium', () => {
  const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
  const BUYER: TgUser = { id: 5005, first_name: 'Buyer', language_code: 'en' };
  const STRANGER: TgUser = { id: 6006, first_name: 'Stranger', language_code: 'en' };

  async function premiumPrice(u: TgUser): Promise<number> {
    const res = await get('/api/products', u);
    expect(res.status).toBe(200);
    const premium = (res.body as Array<{ id: string; priceStars: number }>).find(
      (p) => p.id === 'premium',
    );
    expect(premium).toBeDefined();
    return premium!.priceStars;
  }

  async function invoicePayload(u: TgUser): Promise<string> {
    const before = t.fakeBot.callsOf('createInvoiceLink').length;
    const res = await t.http
      .post('/api/payments/invoice')
      .set('Authorization', auth(u))
      .send({ productId: 'premium' });
    expect(res.status).toBeLessThan(300);
    expect(res.body).toEqual({ invoiceLink: expect.any(String) });
    const calls = t.fakeBot.callsOf('createInvoiceLink');
    expect(calls).toHaveLength(before + 1);
    return String(calls[calls.length - 1].body.payload);
  }

  it('GET /api/premium/content answers 403 NO_ENTITLEMENT before payment', async () => {
    const res = await get('/api/premium/content', STRANGER);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'NO_ENTITLEMENT' });
  });

  it('GET /api/premium/content answers 200 after premium is paid', async () => {
    const price = await premiumPrice(BUYER);
    const payload = await invoicePayload(BUYER);

    const pre = await postWebhook(
      t.http,
      updates.preCheckoutQuery({ payload, totalAmount: price, from: BUYER }),
      HOOK,
    );
    expect(pre.status).toBe(200);
    const answers = t.fakeBot.callsOf('answerPreCheckoutQuery');
    expect(answers[answers.length - 1].body.ok).toBe(true);

    const paid = await postWebhook(
      t.http,
      updates.successfulPayment({
        payload,
        chargeId: 'ch_premium_app_1',
        totalAmount: price,
        from: BUYER,
      }),
      HOOK,
    );
    expect(paid.status).toBe(200);

    const res = await get('/api/premium/content', BUYER);
    expect(res.status).toBe(200);
  });

  it('a payment by one user does not unlock premium for another', async () => {
    const res = await get('/api/premium/content', STRANGER);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, code: 'NO_ENTITLEMENT' });
  });
});

describe('shop: /start shop', () => {
  const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
  const SHOPPER: TgUser = { id: 7007, first_name: 'Shopper', language_code: 'en' };
  const SHOP_URL = 'https://t.me/smoke_app_bot?startapp=shop';

  async function startShop(): Promise<Array<{ text: string; url?: string }>> {
    const before = t.fakeBot.callsOf('sendMessage').length;
    const res = await postWebhook(t.http, updates.command('start', 'shop', SHOPPER), HOOK);
    expect(res.status).toBe(200);
    const sent = t.fakeBot.callsOf('sendMessage').slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.text).toMatch(/\S/);
    return sent[0].body.reply_markup.inline_keyboard.flat();
  }

  it('replies to /start shop with a startapp=shop button', async () => {
    expect(await startShop()).toEqual([expect.objectContaining({ url: SHOP_URL })]);
  });

  it('still replies with the button when greeting and openButton copy are disabled', async () => {
    const copy = t.app.get(BotService).copyFor({ from: SHOPPER } as never);
    const saved = { greeting: copy.greeting, openButton: copy.openButton };
    Object.assign(copy, { greeting: null, openButton: null });
    try {
      expect(await startShop()).toEqual([{ text: expect.stringMatching(/\S/), url: SHOP_URL }]);
    } finally {
      Object.assign(copy, saved);
    }
  });
});
// tma:shop:end
