import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from 'tma-starter/nest-core';
import { TmaBotModule, migrations as botMigrations } from 'tma-starter/nest-bot';
import { Logger } from '@nestjs/common';
import { createTestApp, postWebhook, updates, waitFor } from 'tma-starter/testing';
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
const ADMIN_B: TgUser = { id: 8002, first_name: 'AdminB' };
const PERIOD = 2_592_000;
const PREMIUM_PRICE = 50;
const VIP_PRICE = 100;
const SEAT_PRICE = 30;
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

const seat: Product = {
  id: 'seat',
  kind: 'one_time',
  priceStars: () => SEAT_PRICE,
  title: () => 'Seat',
  description: () => 'Seat for a target',
  lock: async (_trx, targetId) => ({ targetId }),
  settle: async () => undefined,
};

let t: TestApp;
let seq = 0;

const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const nowSec = () => Math.floor(Date.now() / 1000);

const adminRefund = (paymentId: string, admin: TgUser = ADMIN) =>
  t.http.post(`/api/admin/payments/${paymentId}/refund`).set('Authorization', auth(admin));

const paymentRow = (id: string) => t.knex('payments').where({ id }).first();

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

async function invoicePayload(u: TgUser, productId: string, targetId?: string): Promise<string> {
  const res = await t.http
    .post('/api/payments/invoice')
    .set('Authorization', auth(u))
    .send(targetId ? { productId, targetId } : { productId });
  expect(res.status).toBe(200);
  const calls = t.fakeBot.callsOf('createInvoiceLink');
  return String(calls[calls.length - 1].body.payload);
}

const PRICES = { premium: PREMIUM_PRICE, vip: VIP_PRICE, seat: SEAT_PRICE };

async function buy(
  u: TgUser,
  productId: keyof typeof PRICES,
  targetId?: string,
): Promise<{ paymentId: string; charge: string }> {
  const price = PRICES[productId];
  const payload = await invoicePayload(u, productId, targetId);
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
        adminUserIds: [ADMIN.id, ADMIN_B.id],
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
      TmaPaymentsModule.forRoot({ products: [premium, vip, seat], runWorker: false }),
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

  it('admin refund failed at Telegram and completed by retry writes payment.refund with the initiating admin', async () => {
    const buyer: TgUser = { id: 8107, first_name: 'DownAudit' };
    const { paymentId } = await buy(buyer, 'premium');
    const audits = () =>
      t.knex('audit_events').where({ action: 'payment.refund', target_type: 'payment', target_id: paymentId });
    t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 1 });

    expect((await adminRefund(paymentId)).status).toBe(502);
    expect(await audits()).toHaveLength(0);

    await t
      .knex('payments')
      .where({ id: paymentId })
      .update({ refund_attempted_at: t.knex.raw("now() - interval '2 days'") });
    await t.app.get(PaymentsService).retryPendingRefunds();

    expect((await paymentRow(paymentId)).status).toBe('refunded');
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].actor_id)).toBe(ADMIN.id);
    expect(rows[0].meta).toMatchObject({ payerId: buyer.id, productId: 'premium', amountStars: PREMIUM_PRICE });
  });

  it('a manual retry by another admin that fails again leaves the retry to the worker under that admin', async () => {
    const buyer: TgUser = { id: 8115, first_name: 'RetryFail' };
    const { paymentId } = await buy(buyer, 'premium');
    const audits = () =>
      t.knex('audit_events').where({ action: 'payment.refund', target_type: 'payment', target_id: paymentId });
    t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 2 });

    expect((await adminRefund(paymentId)).status).toBe(502);
    expect((await adminRefund(paymentId, ADMIN_B)).status).toBe(502);
    expect(Number((await paymentRow(paymentId)).refund_requested_by)).toBe(ADMIN_B.id);

    await t
      .knex('payments')
      .where({ id: paymentId })
      .update({ refund_attempted_at: t.knex.raw("now() - interval '2 days'") });
    await t.app.get(PaymentsService).retryPendingRefunds();

    expect((await paymentRow(paymentId)).status).toBe('refunded');
    const rows = await audits();
    expect(rows.map((r) => Number(r.actor_id))).toEqual([ADMIN_B.id]);
  });

  it('a manual retry by another admin that succeeds records and audits that admin', async () => {
    const buyer: TgUser = { id: 8116, first_name: 'RetryOk' };
    const { paymentId } = await buy(buyer, 'premium');
    t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 1 });

    expect((await adminRefund(paymentId)).status).toBe(502);
    expect((await adminRefund(paymentId, ADMIN_B)).status).toBe(200);

    const done = await paymentRow(paymentId);
    expect(done.status).toBe('refunded');
    expect(Number(done.refund_requested_by)).toBe(ADMIN_B.id);
    const rows = await t
      .knex('audit_events')
      .where({ action: 'payment.refund', target_type: 'payment', target_id: paymentId });
    expect(rows.map((r) => Number(r.actor_id))).toEqual([ADMIN_B.id]);
  });

  it('unknown payment id → 404 PAYMENT_NOT_FOUND without calling Telegram', async () => {
    const res = await adminRefund(UNKNOWN_ID);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, code: 'PAYMENT_NOT_FOUND' });
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('refunding a targeted purchase keeps the payer\'s own one_time entitlement for that product', async () => {
    const buyer: TgUser = { id: 8108, first_name: 'Targeted' };
    await buy(buyer, 'seat');
    const { paymentId } = await buy(buyer, 'seat', 'room-1');

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(await entitlement(buyer, 'seat')).toMatchObject({ source: 'one_time', expires_at: null });
    expect(await t.app.get(EntitlementsService).has(buyer.id, 'seat')).toBe(true);
  });

  it('refunding a subscription payment whose entitlement is gone succeeds without cancelling in Telegram', async () => {
    const subscriber: TgUser = { id: 8109, first_name: 'Revoked' };
    const { paymentId } = await buy(subscriber, 'vip');
    await t.knex('entitlements').where({ user_id: subscriber.id, product_id: 'vip' }).del();
    t.fakeBot.reset();

    const res = await adminRefund(paymentId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: paymentId, status: 'refunded' });
    expect(t.fakeBot.callsOf('editUserStarSubscription')).toHaveLength(0);
    expect(await entitlement(subscriber, 'vip')).toBeUndefined();
  });

  it('warns once when a refund has failed five times and is still refund_pending', async () => {
    const buyer: TgUser = { id: 8110, first_name: 'Stuck' };
    const { paymentId, charge } = await buy(buyer, 'premium');
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const stuckWarnings = () =>
      warn.mock.calls.filter(([message]) => String(message).startsWith(`refund ${charge} failed`));
    const retryAfterBackoff = async () => {
      await t
        .knex('payments')
        .where({ id: paymentId })
        .update({ refund_attempted_at: t.knex.raw("now() - interval '2 days'") });
      await t.app.get(PaymentsService).retryPendingRefunds();
    };
    try {
      t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 5 });
      expect((await adminRefund(paymentId)).status).toBe(502);
      for (let attempt = 2; attempt <= 4; attempt++) await retryAfterBackoff();

      expect((await paymentRow(paymentId)).refund_attempts).toBe(4);
      expect(stuckWarnings()).toEqual([]);

      await retryAfterBackoff();

      expect((await paymentRow(paymentId)).refund_attempts).toBe(5);
      expect(stuckWarnings()).toEqual([[`refund ${charge} failed 5 times, still refund_pending`]]);

      await retryAfterBackoff();
      expect((await paymentRow(paymentId)).status).toBe('refunded');
      expect(stuckWarnings()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
