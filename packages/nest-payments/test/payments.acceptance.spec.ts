import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import {
  RealtimeService,
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { TmaBotModule, migrations as botMigrations } from '@dmytro-rudenko/tma-nest-bot';
import {
  EntitlementGuard,
  EntitlementsService,
  PaymentsService,
  Product,
  TmaPaymentsModule,
  migrations as paymentsMigrations,
} from '@dmytro-rudenko/tma-nest-payments';
import {
  createTestApp,
  postWebhook,
  signInitData,
  updates,
  waitFor,
} from '@dmytro-rudenko/tma-testing';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string; username?: string; language_code?: string };

const BOT_TOKEN = '123456:PAY-TEST';
const PATH_TOKEN = 'pay-path-token-0123';
const SECRET = 'pay-secret-0123456789';
const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
const ADMIN: TgUser = { id: 1001, first_name: 'Admin' };
const PERIOD = 2_592_000;
const PREMIUM_PRICE = 50;
const VIP_PRICE = 100;

const settled: string[] = [];
const refunded: string[] = [];

const premium: Product = {
  id: 'premium',
  kind: 'one_time',
  priceStars: () => PREMIUM_PRICE,
  title: (lang) => (lang === 'uk' ? 'Преміум' : 'Premium'),
  description: (lang) => (lang === 'uk' ? 'Преміум-доступ' : 'Premium access'),
  settle: async (_trx, payment) => {
    settled.push(payment.id);
  },
  onRefund: async (_trx, payment) => {
    refunded.push(payment.id);
  },
};

const vip: Product = {
  id: 'vip',
  kind: 'subscription',
  priceStars: () => VIP_PRICE,
  title: () => 'VIP',
  description: (lang) => (lang === 'uk' ? 'Підписка VIP' : 'VIP subscription'),
};

@Controller('api/test-premium')
class PremiumTestController {
  @Get()
  @UseGuards(EntitlementGuard('premium'))
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [PremiumTestController] })
class PremiumTestModule {}

let t: TestApp;
let seq = 0;

const nextCharge = (tag: string) => `ch_${tag}_${++seq}`;
const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const nowSec = () => Math.floor(Date.now() / 1000);

function expectError(res: { status: number; body: any }, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ statusCode: status, code });
}

function invoice(u: TgUser, productId: string, targetId?: string) {
  return t.http
    .post('/api/payments/invoice')
    .set('Authorization', auth(u))
    .send(targetId ? { productId, targetId } : { productId });
}

async function invoicePayload(u: TgUser, productId: string): Promise<string> {
  const before = t.fakeBot.callsOf('createInvoiceLink').length;
  const res = await invoice(u, productId);
  expect(res.status).toBeLessThan(300);
  expect(res.body).toEqual({ invoiceLink: expect.any(String) });
  const calls = t.fakeBot.callsOf('createInvoiceLink');
  expect(calls).toHaveLength(before + 1);
  return String(calls[calls.length - 1].body.payload);
}

async function preCheckout(u: TgUser, payload: string, totalAmount: number, currency?: string) {
  const before = t.fakeBot.callsOf('answerPreCheckoutQuery').length;
  const res = await postWebhook(
    t.http,
    updates.preCheckoutQuery({ payload, totalAmount, from: u, ...(currency ? { currency } : {}) }),
    HOOK,
  );
  expect(res.status).toBe(200);
  const calls = t.fakeBot.callsOf('answerPreCheckoutQuery');
  expect(calls).toHaveLength(before + 1);
  return calls[calls.length - 1].body;
}

function pay(
  u: TgUser,
  payload: string,
  totalAmount: number,
  chargeId: string,
  extra: {
    subscriptionExpirationDate?: number;
    isRecurring?: boolean;
    isFirstRecurring?: boolean;
  } = {},
) {
  return postWebhook(
    t.http,
    updates.successfulPayment({ payload, chargeId, totalAmount, from: u, ...extra }),
    HOOK,
  );
}

async function buyPremium(u: TgUser): Promise<{ payload: string; charge: string; paymentId: string }> {
  const payload = await invoicePayload(u, 'premium');
  expect((await preCheckout(u, payload, PREMIUM_PRICE)).ok).toBe(true);
  const charge = nextCharge('premium');
  expect((await pay(u, payload, PREMIUM_PRICE, charge)).status).toBe(200);
  const row = await t.knex('payments').where({ telegram_payment_charge_id: charge }).first();
  return { payload, charge, paymentId: row.id };
}

async function subscribeVip(u: TgUser, expiresAt = nowSec() + PERIOD) {
  const payload = await invoicePayload(u, 'vip');
  expect((await preCheckout(u, payload, VIP_PRICE)).ok).toBe(true);
  const charge = nextCharge('vip');
  const res = await pay(u, payload, VIP_PRICE, charge, {
    subscriptionExpirationDate: expiresAt,
    isRecurring: true,
    isFirstRecurring: true,
  });
  expect(res.status).toBe(200);
  const row = await t.knex('payments').where({ telegram_payment_charge_id: charge }).first();
  return { payload, charge, expiresAt, paymentId: row.id as string };
}

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

const paymentsOf = (u: TgUser) =>
  t.knex('payments').where({ payer_id: u.id }).orderBy('created_at', 'asc');

async function listenUrl(): Promise<string> {
  const server = t.app.getHttpServer();
  if (!server.listening) await t.app.listen(0, '127.0.0.1');
  return (await t.app.getUrl()).replace('[::1]', '127.0.0.1');
}

beforeAll(async () => {
  t = await createTestApp({
    botToken: BOT_TOKEN,
    migrations: composeMigrations(coreMigrations, botMigrations, paymentsMigrations),
    imports: (ctx) => [
      TmaCoreModule.forRoot({
        knex: ctx.knex,
        botToken: ctx.botToken,
        adminUserIds: [ADMIN.id],
        runWorker: false,
        throttle: { ttlMs: 60_000, limit: 100_000 },
      }),
      TmaBotModule.forRoot({
        botToken: ctx.botToken,
        botUsername: 'demo_app_bot',
        webappUrl: 'https://demo.example.com',
        webhookPathToken: PATH_TOKEN,
        webhookSecret: SECRET,
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
      TmaPaymentsModule.forRoot({ products: [premium, vip], runWorker: false }),
      PremiumTestModule,
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  settled.length = 0;
  refunded.length = 0;
  t.fakeBot.reset();
});

describe('tma-nest-payments acceptance', () => {
  it('one_time end-to-end: invoice → pre_checkout ok → successful_payment → settle once', async () => {
    const u: TgUser = { id: 3001, first_name: 'Olia', language_code: 'uk' };
    const payload = await invoicePayload(u, 'premium');

    const link = t.fakeBot.callsOf('createInvoiceLink')[0].body;
    expect(link).toMatchObject({
      title: 'Преміум',
      description: 'Преміум-доступ',
      currency: 'XTR',
      prices: [{ label: 'Преміум', amount: PREMIUM_PRICE }],
    });
    expect(link.subscription_period).toBeUndefined();
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(128);
    expect(payload.startsWith('premium:-:')).toBe(true);

    const answer = await preCheckout(u, payload, PREMIUM_PRICE);
    expect(answer.ok).toBe(true);

    const charge = nextCharge('e2e');
    expect((await pay(u, payload, PREMIUM_PRICE, charge)).status).toBe(200);

    const rows = await paymentsOf(u);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      product_id: 'premium',
      amount_stars: PREMIUM_PRICE,
      invoice_payload: payload,
      telegram_payment_charge_id: charge,
      is_recurring: false,
      status: 'paid',
    });
    expect(settled).toEqual([rows[0].id]);
    expect(await entitlement(u, 'premium')).toMatchObject({ source: 'one_time', expires_at: null });
    expect(await t.app.get(EntitlementsService).has(u.id, 'premium')).toBe(true);

    const ents = await t.http.get('/api/entitlements').set('Authorization', auth(u));
    expect(ents.body).toEqual([
      expect.objectContaining({ productId: 'premium', source: 'one_time', expiresAt: null, canceled: false }),
    ]);
    await waitFor(async () => t.fakeBot.callsOf('sendMessage').some((c) => Number(c.body.chat_id) === u.id), 3000);
  });

  it('pre_checkout rejects wrong amount, wrong currency, blocked payer', async () => {
    const u: TgUser = { id: 3002, first_name: 'Taras' };
    const payload = await invoicePayload(u, 'premium');

    const wrongAmount = await preCheckout(u, payload, PREMIUM_PRICE - 1);
    expect(wrongAmount.ok).toBe(false);
    expect(typeof wrongAmount.error_message).toBe('string');
    expect(wrongAmount.error_message.length).toBeGreaterThan(0);

    expect((await preCheckout(u, payload, PREMIUM_PRICE, 'USD')).ok).toBe(false);
    expect((await preCheckout(u, 'premium:-:garbage-payload-xx', PREMIUM_PRICE)).ok).toBe(false);

    await t.knex('users').where({ id: u.id }).update({ blocked_at: t.knex.fn.now() });
    expect((await preCheckout(u, payload, PREMIUM_PRICE)).ok).toBe(false);
    await t.knex('users').where({ id: u.id }).update({ blocked_at: null });

    expect((await preCheckout(u, payload, PREMIUM_PRICE)).ok).toBe(true);
  });

  it('duplicate charge id is a no-op', async () => {
    const u: TgUser = { id: 3003, first_name: 'Dup' };
    const { payload, charge } = await buyPremium(u);
    expect(settled).toHaveLength(1);

    expect((await pay(u, payload, PREMIUM_PRICE, charge)).status).toBe(200);
    expect(await paymentsOf(u)).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('second payment of same one_time invoice → refund_pending → refundStarPayment', async () => {
    const u: TgUser = { id: 3004, first_name: 'Twice' };
    const { payload } = await buyPremium(u);
    const second = nextCharge('second');

    expect((await pay(u, payload, PREMIUM_PRICE, second)).status).toBe(200);

    const refundCalls = await waitFor(async () => {
      const calls = t.fakeBot.callsOf('refundStarPayment');
      return calls.length > 0 ? calls : null;
    }, 3000);
    expect(refundCalls).toHaveLength(1);
    expect(refundCalls[0].body).toMatchObject({ user_id: u.id, telegram_payment_charge_id: second });

    const rows = await paymentsOf(u);
    expect(rows).toHaveLength(2);
    const dup = rows.find((r: any) => r.telegram_payment_charge_id === second);
    expect(dup.status).toBe('refunded');
    expect(settled).toHaveLength(1);
    expect(await entitlement(u, 'premium')).toBeDefined();
  });

  it('parallel duplicate successful_payment deliveries record once and settle once', async () => {
    const u: TgUser = { id: 3019, first_name: 'Racer' };
    const payload = await invoicePayload(u, 'premium');
    expect((await preCheckout(u, payload, PREMIUM_PRICE)).ok).toBe(true);
    const charge = nextCharge('race');

    const results = await Promise.all([
      pay(u, payload, PREMIUM_PRICE, charge),
      pay(u, payload, PREMIUM_PRICE, charge),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);

    const rows = await paymentsOf(u);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ telegram_payment_charge_id: charge, status: 'paid' });
    expect(settled).toEqual([rows[0].id]);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
    expect(await entitlement(u, 'premium')).toMatchObject({ source: 'one_time' });
  });

  it('renewal for admin-blocked user is still recorded and extends expires_at', async () => {
    const u: TgUser = { id: 3020, first_name: 'BlockedRenewal' };
    const first = await subscribeVip(u);

    const block = await t.http
      .post(`/api/admin/users/${u.id}/block`)
      .set('Authorization', auth(ADMIN));
    expect(block.status).toBeLessThan(300);
    expect((await t.knex('users').where({ id: u.id }).first()).blocked_at).not.toBeNull();

    const renewedUntil = first.expiresAt + PERIOD;
    const renewal = nextCharge('blocked-renewal');
    const res = await pay(u, first.payload, VIP_PRICE, renewal, {
      subscriptionExpirationDate: renewedUntil,
      isRecurring: true,
      isFirstRecurring: false,
    });
    expect(res.status).toBe(200);

    const rows = await paymentsOf(u);
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.telegram_payment_charge_id === renewal)).toMatchObject({
      status: 'paid',
      is_recurring: true,
    });
    const ent = await entitlement(u, 'vip');
    expect(Math.floor(new Date(ent.expires_at).getTime() / 1000)).toBe(renewedUntil);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('ALREADY_OWNED and ALREADY_SUBSCRIBED on invoice and on pre_checkout', async () => {
    const owner: TgUser = { id: 3005, first_name: 'Owner' };
    const spare = await invoicePayload(owner, 'premium');
    await buyPremium(owner);
    expectError(await invoice(owner, 'premium'), 409, 'ALREADY_OWNED');
    expect((await preCheckout(owner, spare, PREMIUM_PRICE)).ok).toBe(false);

    const subscriber: TgUser = { id: 3006, first_name: 'Subscriber' };
    const spareSub = await invoicePayload(subscriber, 'vip');
    await subscribeVip(subscriber);
    expectError(await invoice(subscriber, 'vip'), 409, 'ALREADY_SUBSCRIBED');
    expect((await preCheckout(subscriber, spareSub, VIP_PRICE)).ok).toBe(false);
  });

  it('subscription first payment creates entitlement with expires_at', async () => {
    const u: TgUser = { id: 3007, first_name: 'Sub' };
    const payload = await invoicePayload(u, 'vip');
    expect(t.fakeBot.callsOf('createInvoiceLink')[0].body).toMatchObject({
      currency: 'XTR',
      subscription_period: PERIOD,
      prices: [{ label: 'VIP', amount: VIP_PRICE }],
    });

    expect((await preCheckout(u, payload, VIP_PRICE)).ok).toBe(true);
    const expiresAt = nowSec() + PERIOD;
    const charge = nextCharge('first');
    const res = await pay(u, payload, VIP_PRICE, charge, {
      subscriptionExpirationDate: expiresAt,
      isRecurring: true,
      isFirstRecurring: true,
    });
    expect(res.status).toBe(200);

    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({ source: 'subscription', subscription_charge_id: charge, canceled_at: null });
    expect(Math.floor(new Date(ent.expires_at).getTime() / 1000)).toBe(expiresAt);
    expect((await paymentsOf(u))[0]).toMatchObject({ is_recurring: true, status: 'paid' });
    expect(settled).toEqual([]);
  });

  it('renewal with same payload adds row and moves expires_at; duplicate renewal no-op', async () => {
    const u: TgUser = { id: 3008, first_name: 'Renew' };
    const first = await subscribeVip(u);
    const renewedUntil = first.expiresAt + PERIOD;
    const renewal = nextCharge('renewal');

    const res = await pay(u, first.payload, VIP_PRICE, renewal, {
      subscriptionExpirationDate: renewedUntil,
      isRecurring: true,
      isFirstRecurring: false,
    });
    expect(res.status).toBe(200);
    expect(await paymentsOf(u)).toHaveLength(2);
    const ent = await entitlement(u, 'vip');
    expect(Math.floor(new Date(ent.expires_at).getTime() / 1000)).toBe(renewedUntil);
    expect(ent.subscription_charge_id).toBe(first.charge);

    const dup = await pay(u, first.payload, VIP_PRICE, renewal, {
      subscriptionExpirationDate: renewedUntil + PERIOD,
      isRecurring: true,
      isFirstRecurring: false,
    });
    expect(dup.status).toBe(200);
    expect(await paymentsOf(u)).toHaveLength(2);
    const after = await entitlement(u, 'vip');
    expect(Math.floor(new Date(after.expires_at).getTime() / 1000)).toBe(renewedUntil);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('cancel/resume call editUserStarSubscription and set canceled_at', async () => {
    const u: TgUser = { id: 3009, first_name: 'Cancel' };
    const { charge } = await subscribeVip(u);

    const cancel = await t.http.post('/api/subscriptions/vip/cancel').set('Authorization', auth(u));
    expect(cancel.status).toBeLessThan(300);
    expect(t.fakeBot.callsOf('editUserStarSubscription').map((c) => c.body)).toEqual([
      expect.objectContaining({ user_id: u.id, telegram_payment_charge_id: charge, is_canceled: true }),
    ]);
    expect((await entitlement(u, 'vip')).canceled_at).not.toBeNull();
    expect(await t.app.get(EntitlementsService).has(u.id, 'vip')).toBe(true);

    const resume = await t.http.post('/api/subscriptions/vip/resume').set('Authorization', auth(u));
    expect(resume.status).toBeLessThan(300);
    const calls = t.fakeBot.callsOf('editUserStarSubscription');
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({
      user_id: u.id,
      telegram_payment_charge_id: charge,
      is_canceled: false,
    });
    expect((await entitlement(u, 'vip')).canceled_at).toBeNull();
  });

  it('has() false after expires_at; EntitlementGuard → 403 NO_ENTITLEMENT', async () => {
    const u: TgUser = { id: 3010, first_name: 'Guarded' };
    const entitlements = t.app.get(EntitlementsService);
    expectError(
      await t.http.get('/api/test-premium').set('Authorization', auth(u)),
      403,
      'NO_ENTITLEMENT',
    );

    await t.knex('entitlements').insert({
      user_id: u.id,
      product_id: 'premium',
      source: 'grant',
      expires_at: new Date(Date.now() - 60_000),
    });
    expect(await entitlements.has(u.id, 'premium')).toBe(false);
    expectError(
      await t.http.get('/api/test-premium').set('Authorization', auth(u)),
      403,
      'NO_ENTITLEMENT',
    );

    await t
      .knex('entitlements')
      .where({ user_id: u.id, product_id: 'premium' })
      .update({ expires_at: new Date(Date.now() + 60_000) });
    expect(await entitlements.has(u.id, 'premium')).toBe(true);
    const ok = await t.http.get('/api/test-premium').set('Authorization', auth(u));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
  });

  it('refund of one_time calls onRefund and revokes entitlement; refund of subscription expires access and cancels', async () => {
    const buyer: TgUser = { id: 3011, first_name: 'Refund' };
    const { paymentId, charge } = await buyPremium(buyer);

    const res = await t.http
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', auth(ADMIN));
    expect(res.status).toBeLessThan(300);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      expect.objectContaining({ user_id: buyer.id, telegram_payment_charge_id: charge }),
    ]);
    expect(refunded).toEqual([paymentId]);
    expect(await entitlement(buyer, 'premium')).toBeUndefined();
    expect((await t.knex('payments').where({ id: paymentId }).first()).refunded_at).not.toBeNull();

    expectError(
      await t.http.post(`/api/admin/payments/${paymentId}/refund`).set('Authorization', auth(ADMIN)),
      409,
      'ALREADY_REFUNDED',
    );

    const subscriber: TgUser = { id: 3012, first_name: 'SubRefund' };
    const sub = await subscribeVip(subscriber);
    t.fakeBot.reset();
    const subRes = await t.http
      .post(`/api/admin/payments/${sub.paymentId}/refund`)
      .set('Authorization', auth(ADMIN));
    expect(subRes.status).toBeLessThan(300);
    const ent = await entitlement(subscriber, 'vip');
    expect(new Date(ent.expires_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(await t.app.get(EntitlementsService).has(subscriber.id, 'vip')).toBe(false);
    expect(t.fakeBot.callsOf('editUserStarSubscription').map((c) => c.body)).toEqual([
      expect.objectContaining({
        user_id: subscriber.id,
        telegram_payment_charge_id: sub.charge,
        is_canceled: true,
      }),
    ]);
  });

  it('refundStarPayment failure leaves refund_pending; retryPendingRefunds completes it', async () => {
    const u: TgUser = { id: 3013, first_name: 'Retry' };
    const { payload } = await buyPremium(u);
    const second = nextCharge('retry');

    t.fakeBot.respond(
      'refundStarPayment',
      { ok: false, error_code: 500, description: 'Internal Server Error' },
      { times: 1 },
    );
    const res = await pay(u, payload, PREMIUM_PRICE, second);
    expect(res.status).toBe(500);

    const pending = await t.knex('payments').where({ telegram_payment_charge_id: second }).first();
    expect(pending.status).toBe('refund_pending');

    await t.app.get(PaymentsService).retryPendingRefunds();
    const done = await t.knex('payments').where({ telegram_payment_charge_id: second }).first();
    expect(done.status).toBe('refunded');
    const calls = t.fakeBot.callsOf('refundStarPayment');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.body).toMatchObject({ telegram_payment_charge_id: second });
  });

  it('test mode: admin in payments.test_users gets { settled: true }, amount 0, audit payment.test_settle', async () => {
    const settings = await t.http
      .patch('/api/admin/settings')
      .set('Authorization', auth(ADMIN))
      .send({ key: 'payments.test_users', value: [ADMIN.id] });
    expect(settings.status).toBe(200);

    try {
      const res = await invoice(ADMIN, 'premium');
      expect(res.status).toBeLessThan(300);
      expect(res.body).toEqual({ settled: true });
      expect(t.fakeBot.callsOf('createInvoiceLink')).toHaveLength(0);

      const rows = await paymentsOf(ADMIN);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ product_id: 'premium', amount_stars: 0, status: 'paid' });
      expect(rows[0].telegram_payment_charge_id).toMatch(/^test:/);
      expect(settled).toEqual([rows[0].id]);
      expect(await entitlement(ADMIN, 'premium')).toBeDefined();
      expect(await t.knex('audit_events').where({ action: 'payment.test_settle' })).toHaveLength(1);

      const sub = await invoice(ADMIN, 'vip');
      expect(sub.body).toEqual({ settled: true });
      const ent = await entitlement(ADMIN, 'vip');
      expect(ent).toMatchObject({ source: 'subscription', subscription_charge_id: null });
      expect(new Date(ent.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      expectError(
        await t.http.post('/api/subscriptions/vip/cancel').set('Authorization', auth(ADMIN)),
        409,
        'NO_SUBSCRIPTION',
      );
    } finally {
      const restored = await t.http
        .patch('/api/admin/settings')
        .set('Authorization', auth(ADMIN))
        .send({ key: 'payments.test_users', value: [] });
      expect(restored.status).toBe(200);
    }
  });

  it('admin grant over active subscription → 409 ENTITLEMENT_HELD_BY_SUBSCRIPTION; admin DELETE subscription cancels in Telegram first', async () => {
    const u: TgUser = { id: 3014, first_name: 'Held' };
    const { charge } = await subscribeVip(u);
    const asAdmin = (req: any) => req.set('Authorization', auth(ADMIN));

    expectError(
      await asAdmin(t.http.post(`/api/admin/users/${u.id}/entitlements`)).send({ productId: 'vip' }),
      409,
      'ENTITLEMENT_HELD_BY_SUBSCRIPTION',
    );
    expect(await entitlement(u, 'vip')).toMatchObject({ source: 'subscription' });

    const grant = await asAdmin(t.http.post(`/api/admin/users/${u.id}/entitlements`)).send({
      productId: 'premium',
    });
    expect(grant.status).toBeLessThan(300);
    expect(await entitlement(u, 'premium')).toMatchObject({ source: 'grant', expires_at: null });
    expect(await t.knex('audit_events').where({ action: 'entitlement.grant' })).toHaveLength(1);

    t.fakeBot.respond(
      'editUserStarSubscription',
      { ok: false, error_code: 400, description: 'Bad Request: SUBSCRIPTION_NOT_FOUND' },
      { times: 1 },
    );
    const failed = await asAdmin(t.http.delete(`/api/admin/users/${u.id}/entitlements/vip`));
    expect(failed.status).toBe(502);
    expect(await entitlement(u, 'vip')).toBeDefined();

    const removed = await asAdmin(t.http.delete(`/api/admin/users/${u.id}/entitlements/vip`));
    expect(removed.status).toBe(204);
    const calls = t.fakeBot.callsOf('editUserStarSubscription');
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({
      user_id: u.id,
      telegram_payment_charge_id: charge,
      is_canceled: true,
    });
    expect(await entitlement(u, 'vip')).toBeUndefined();
    expect(await t.knex('audit_events').where({ action: 'entitlement.revoke' })).toHaveLength(1);
  });

  it('admin refund writes audit payment.refund', async () => {
    const u: TgUser = { id: 3015, first_name: 'Audit' };
    const { paymentId } = await buyPremium(u);
    const before = await t.knex('audit_events').where({ action: 'payment.refund' });

    const res = await t.http
      .post(`/api/admin/payments/${paymentId}/refund`)
      .set('Authorization', auth(ADMIN));
    expect(res.status).toBeLessThan(300);

    const after = await t.knex('audit_events').where({ action: 'payment.refund' });
    expect(after).toHaveLength(before.length + 1);
    const row = after.find((r: any) => r.target_id === String(paymentId));
    expect(row).toBeDefined();
    expect(Number(row.actor_id)).toBe(ADMIN.id);

    expectError(
      await t.http.post(`/api/admin/payments/00000000-0000-4000-8000-000000000000/refund`).set('Authorization', auth(ADMIN)),
      404,
      'PAYMENT_NOT_FOUND',
    );
    const plain: TgUser = { id: 3016, first_name: 'Plain' };
    expectError(
      await t.http.post(`/api/admin/payments/${paymentId}/refund`).set('Authorization', auth(plain)),
      403,
      'NOT_ADMIN',
    );
  });

  it('reconcile reports invoice_payment transactions missing from payments', async () => {
    const u: TgUser = { id: 3017, first_name: 'Reconcile' };
    const { charge, payload } = await buyPremium(u);
    const date = nowSec();
    const userSource = (transaction_type: string, invoice_payload?: string) => ({
      type: 'user',
      transaction_type,
      user: { id: u.id, is_bot: false, first_name: u.first_name },
      ...(invoice_payload ? { invoice_payload } : {}),
    });
    t.fakeBot.respond('getStarTransactions', {
      ok: true,
      result: {
        transactions: [
          { id: charge, amount: PREMIUM_PRICE, date, source: userSource('invoice_payment', payload) },
          { id: 'ch_missing_777', amount: PREMIUM_PRICE, date, source: userSource('invoice_payment', 'premium:-:missingNonce') },
          { id: 'gift_888', amount: 15, date, source: userSource('gift_purchase') },
        ],
      },
    });

    const res = await t.http
      .post('/api/admin/payments/reconcile')
      .set('Authorization', auth(ADMIN));
    expect(res.status).toBeLessThan(300);
    const report = JSON.stringify(res.body);
    expect(report).toContain('ch_missing_777');
    expect(report).not.toContain(charge);
    expect(report).not.toContain('gift_888');
    expect(t.fakeBot.callsOf('getStarTransactions').length).toBeGreaterThanOrEqual(1);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('payment.settled realtime event emitted after commit', async () => {
    const u: TgUser = { id: 3018, first_name: 'Live' };
    const url = await listenUrl();
    const socket: Socket = io(url, {
      path: '/api/socket.io',
      auth: { initData: signInitData(u, BOT_TOKEN) },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    try {
      const probes: unknown[] = [];
      socket.on('test.probe', (p) => probes.push(p));
      const realtime = t.app.get(RealtimeService);
      await waitFor(async () => {
        realtime.emitToUser(u.id, 'test.probe', {});
        return probes.length > 0;
      }, 5000);

      const events: Array<{ payload: any; row: any }> = [];
      socket.on('payment.settled', async (payload: any) => {
        const row = await t.knex('payments').where({ id: payload.paymentId }).first();
        events.push({ payload, row });
      });

      const { paymentId } = await buyPremium(u);
      await waitFor(async () => events.length > 0, 5000);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ productId: 'premium', paymentId });
      expect(events[0].row).toMatchObject({ id: paymentId, status: 'paid' });
    } finally {
      socket.disconnect();
    }
  });
});
