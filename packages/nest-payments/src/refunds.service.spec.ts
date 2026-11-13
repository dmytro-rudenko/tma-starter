import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { TmaBotModule, migrations as botMigrations } from '@dmytro-rudenko/tma-nest-bot';
import { createTestApp, postWebhook, updates, waitFor } from '@dmytro-rudenko/tma-testing';
import { EntitlementsService } from './entitlements.service';
import { migrations as paymentsMigrations } from './migrations';
import { TmaPaymentsModule } from './payments.module';
import { PaymentsService } from './payments.service';
import type { Product } from './product';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string };

const BOT_TOKEN = '123456:REFUND-TEST';
const PATH_TOKEN = 'refund-path-token-01';
const SECRET = 'refund-secret-0123456789';
const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
const ADMIN: TgUser = { id: 8001, first_name: 'Admin' };
const PERIOD = 2_592_000;
const PREMIUM_PRICE = 50;
const VIP_PRICE = 100;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const PROVIDER_DOWN = { ok: false as const, error_code: 500, description: 'Internal Server Error' };
const ALREADY_REFUNDED = {
  ok: false as const,
  error_code: 400,
  description: 'Bad Request: CHARGE_ALREADY_REFUNDED',
};

const onRefundCalls: string[] = [];

const premium: Product = {
  id: 'premium',
  kind: 'one_time',
  priceStars: () => PREMIUM_PRICE,
  title: () => 'Premium',
  description: () => 'Premium access',
  onRefund: async (_trx, payment) => {
    onRefundCalls.push(payment.id);
  },
};

const vip: Product = {
  id: 'vip',
  kind: 'subscription',
  priceStars: () => VIP_PRICE,
  title: () => 'VIP',
  description: () => 'VIP subscription',
  onRefund: async (_trx, payment) => {
    onRefundCalls.push(payment.id);
  },
};

let t: TestApp;
let seq = 0;

const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const nowSec = () => Math.floor(Date.now() / 1000);

const adminRefund = (paymentId: string) =>
  t.http.post(`/api/admin/payments/${paymentId}/refund`).set('Authorization', auth(ADMIN));

const paymentRow = (id: string) => t.knex('payments').where({ id }).first();

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

async function invoicePayload(u: TgUser, productId: string): Promise<string> {
  const res = await t.http
    .post('/api/payments/invoice')
    .set('Authorization', auth(u))
    .send({ productId });
  expect(res.status).toBe(200);
  const calls = t.fakeBot.callsOf('createInvoiceLink');
  return String(calls[calls.length - 1].body.payload);
}

async function buy(
  u: TgUser,
  productId: 'premium' | 'vip',
): Promise<{ paymentId: string; charge: string }> {
  const price = productId === 'premium' ? PREMIUM_PRICE : VIP_PRICE;
  const payload = await invoicePayload(u, productId);
  const charge = `ch_refunds_${productId}_${++seq}`;
  const recurring =
    productId === 'vip'
      ? { subscriptionExpirationDate: nowSec() + PERIOD, isRecurring: true, isFirstRecurring: true }
      : {};
  const res = await postWebhook(
    t.http,
    updates.successfulPayment({ payload, chargeId: charge, totalAmount: price, from: u, ...recurring }),
    HOOK,
  );
  expect(res.status).toBe(200);
  const row = await t.knex('payments').where({ telegram_payment_charge_id: charge }).first();
  expect(row.status).toBe('paid');
  expect(row.settled_at).not.toBeNull();
  return { paymentId: row.id, charge };
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
        botUsername: 'refund_test_bot',
        webappUrl: 'https://refund.example.com',
        webhookPathToken: PATH_TOKEN,
        webhookSecret: SECRET,
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
      TmaPaymentsModule.forRoot({ products: [premium, vip], runWorker: false }),
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  onRefundCalls.length = 0;
  t.fakeBot.reset();
});

describe('admin refund', () => {
  it('refunds a paid one_time payment: refundStarPayment, refunded + refunded_at, onRefund once, entitlement deleted, paymentRefunded sent', async () => {
    const buyer: TgUser = { id: 8101, first_name: 'OneTime' };
    const { paymentId, charge } = await buy(buyer, 'premium');
    expect(await entitlement(buyer, 'premium')).toMatchObject({ source: 'one_time' });
    t.fakeBot.reset();

    const before = Date.now();
    const res = await adminRefund(paymentId);
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      { user_id: buyer.id, telegram_payment_charge_id: charge },
    ]);
    const row = await paymentRow(paymentId);
    expect(row.status).toBe('refunded');
    const refundedAt = new Date(row.refunded_at).getTime();
    expect(refundedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(refundedAt).toBeLessThanOrEqual(after + 1000);
    expect(onRefundCalls).toEqual([paymentId]);
    expect(await entitlement(buyer, 'premium')).toBeUndefined();
    expect(await t.app.get(EntitlementsService).has(buyer.id, 'premium')).toBe(false);

    const texts = await waitFor(async () => {
      const sent = t.fakeBot
        .callsOf('sendMessage')
        .filter((c) => Number(c.body.chat_id) === buyer.id)
        .map((c) => c.body.text);
      return sent.length > 0 ? sent : null;
    }, 3000);
    expect(texts).toEqual([`↩️ Refunded ${PREMIUM_PRICE} ⭐ for <b>Premium</b>.`]);
  });

  it('refunds a subscription payment: expires_at = now(), has() false, editUserStarSubscription is_canceled true, onRefund once', async () => {
    const subscriber: TgUser = { id: 8102, first_name: 'Sub' };
    const { paymentId, charge } = await buy(subscriber, 'vip');
    expect(await t.app.get(EntitlementsService).has(subscriber.id, 'vip')).toBe(true);
    t.fakeBot.reset();

    const before = Date.now();
    const res = await adminRefund(paymentId);
    const after = Date.now();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      { user_id: subscriber.id, telegram_payment_charge_id: charge },
    ]);
    expect(t.fakeBot.callsOf('editUserStarSubscription').map((c) => c.body)).toEqual([
      { user_id: subscriber.id, telegram_payment_charge_id: charge, is_canceled: true },
    ]);
    expect(onRefundCalls).toEqual([paymentId]);

    const ent = await entitlement(subscriber, 'vip');
    expect(ent.source).toBe('subscription');
    const expiresAt = new Date(ent.expires_at).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 1000);
    expect(await t.app.get(EntitlementsService).has(subscriber.id, 'vip')).toBe(false);
    expect((await paymentRow(paymentId)).status).toBe('refunded');
  });

  it('keeps an entitlement that no longer comes from the refunded payment', async () => {
    const buyer: TgUser = { id: 8103, first_name: 'Granted' };
    const { paymentId } = await buy(buyer, 'premium');
    await t
      .knex('entitlements')
      .where({ user_id: buyer.id, product_id: 'premium' })
      .update({ source: 'grant' });

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(200);
    expect(onRefundCalls).toEqual([paymentId]);
    expect(await entitlement(buyer, 'premium')).toMatchObject({ source: 'grant', expires_at: null });
    expect(await t.app.get(EntitlementsService).has(buyer.id, 'premium')).toBe(true);
  });

  it('second refund of the same payment → 409 ALREADY_REFUNDED without calling Telegram or onRefund', async () => {
    const buyer: TgUser = { id: 8104, first_name: 'Twice' };
    const { paymentId } = await buy(buyer, 'premium');
    expect((await adminRefund(paymentId)).status).toBe(200);
    const first = await paymentRow(paymentId);
    t.fakeBot.reset();
    onRefundCalls.length = 0;

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, code: 'ALREADY_REFUNDED' });
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
    expect(onRefundCalls).toEqual([]);
    const row = await paymentRow(paymentId);
    expect(row.status).toBe('refunded');
    expect(new Date(row.refunded_at).getTime()).toBe(new Date(first.refunded_at).getTime());
  });

  it('Telegram CHARGE_ALREADY_REFUNDED counts as success', async () => {
    const buyer: TgUser = { id: 8105, first_name: 'AlreadyTg' };
    const { paymentId, charge } = await buy(buyer, 'premium');
    t.fakeBot.reset();
    t.fakeBot.respond('refundStarPayment', ALREADY_REFUNDED, { times: 1 });

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      { user_id: buyer.id, telegram_payment_charge_id: charge },
    ]);
    const row = await paymentRow(paymentId);
    expect(row.status).toBe('refunded');
    expect(row.refunded_at).not.toBeNull();
    expect(onRefundCalls).toEqual([paymentId]);
    expect(await entitlement(buyer, 'premium')).toBeUndefined();
  });

  it('failing refundStarPayment → 502 PAYMENT_PROVIDER_UNAVAILABLE, row stays refund_pending, retry completes it with onRefund once', async () => {
    const buyer: TgUser = { id: 8106, first_name: 'Down' };
    const { paymentId, charge } = await buy(buyer, 'premium');
    t.fakeBot.reset();
    t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 1 });

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ statusCode: 502, code: 'PAYMENT_PROVIDER_UNAVAILABLE' });
    const pending = await paymentRow(paymentId);
    expect(pending.status).toBe('refund_pending');
    expect(pending.refunded_at).toBeNull();
    expect(onRefundCalls).toEqual([]);
    expect(await entitlement(buyer, 'premium')).toMatchObject({ source: 'one_time' });

    await t
      .knex('payments')
      .where({ id: paymentId })
      .whereNotNull('refund_attempted_at')
      .update({ refund_attempted_at: t.knex.raw("now() - interval '2 days'") });
    await t.app.get(PaymentsService).retryPendingRefunds();

    const done = await paymentRow(paymentId);
    expect(done.status).toBe('refunded');
    expect(done.refunded_at).not.toBeNull();
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      { user_id: buyer.id, telegram_payment_charge_id: charge },
      { user_id: buyer.id, telegram_payment_charge_id: charge },
    ]);
    expect(onRefundCalls).toEqual([paymentId]);
    expect(await entitlement(buyer, 'premium')).toBeUndefined();
  });

  it('unknown payment id → 404 PAYMENT_NOT_FOUND without calling Telegram', async () => {
    const res = await adminRefund(UNKNOWN_ID);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });
});
