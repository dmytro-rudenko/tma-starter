import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { TmaBotModule, migrations as botMigrations } from '@dmytro-rudenko/tma-nest-bot';
import {
  PaymentsService,
  Product,
  TmaPaymentsModule,
  migrations as paymentsMigrations,
} from '@dmytro-rudenko/tma-nest-payments';
import { createTestApp, postWebhook, updates, waitFor } from '@dmytro-rudenko/tma-testing';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string; username?: string; language_code?: string };

const BOT_TOKEN = '123456:PAY-HARDENING';
const PATH_TOKEN = 'pay-hard-path-token-0123';
const SECRET = 'pay-hard-secret-0123456789';
const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
const ADMIN: TgUser = { id: 1001, first_name: 'Admin' };
const PERIOD = 2_592_000;
const PREMIUM_PRICE = 50;
const GATED_PRICE = 30;
const LIMITED_PRICE = 20;
const VIP_PRICE = 100;
const PROVIDER_DOWN = { ok: false as const, error_code: 500, description: 'Internal Server Error' };

const settled: string[] = [];
const refunded: string[] = [];
let limitedOpen = true;

const record = (list: string[]) => async (_trx: unknown, payment: { id: string }) => {
  list.push(payment.id);
};

const premium: Product = {
  id: 'premium',
  kind: 'one_time',
  priceStars: () => PREMIUM_PRICE,
  title: (lang) => (lang === 'uk' ? 'Преміум' : 'Premium'),
  description: (lang) => (lang === 'uk' ? 'Преміум-доступ' : 'Premium access'),
  settle: record(settled),
  onRefund: record(refunded),
};

const gated: Product = {
  id: 'gated',
  kind: 'one_time',
  priceStars: () => GATED_PRICE,
  title: () => 'Gated',
  description: () => 'Gated target',
  lock: async (_trx, targetId) => (targetId === 'open' ? { targetId } : null),
  settle: record(settled),
  onRefund: record(refunded),
};

const limited: Product = {
  id: 'limited',
  kind: 'one_time',
  repeatable: true,
  priceStars: () => LIMITED_PRICE,
  title: () => 'Limited',
  description: () => 'Limited offer',
  validate: () => limitedOpen,
  settle: record(settled),
  onRefund: record(refunded),
};

const vip: Product = {
  id: 'vip',
  kind: 'subscription',
  priceStars: () => VIP_PRICE,
  title: () => 'VIP',
  description: (lang) => (lang === 'uk' ? 'Підписка VIP' : 'VIP subscription'),
  onRefund: record(refunded),
};

const broken: Product = {
  id: 'broken',
  kind: 'one_time',
  priceStars: () => {
    throw new Error('pricing backend down');
  },
  title: () => 'Broken',
  description: () => 'Price lookup throws',
};

const REFILL_PRICE = 10;

const refill: Product = {
  id: 'refill',
  kind: 'one_time',
  repeatable: true,
  priceStars: () => REFILL_PRICE,
  title: () => 'Refill',
  description: () => 'Consumable refill',
  onRefund: record(refunded),
};

const priced = (id: string, price: number): Product => ({
  id,
  kind: 'one_time',
  repeatable: true,
  priceStars: () => price,
  title: () => id,
  description: () => `${id} price`,
});

let t: TestApp;
let seq = 0;

const nextCharge = (tag: string) => `ch_${tag}_${++seq}`;
const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);
const nowSec = () => Math.floor(Date.now() / 1000);
const sec = (d: Date | string) => Math.floor(new Date(d).getTime() / 1000);

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

async function invoicePayload(u: TgUser, productId: string, targetId?: string): Promise<string> {
  const before = t.fakeBot.callsOf('createInvoiceLink').length;
  const res = await invoice(u, productId, targetId);
  expect(res.status).toBeLessThan(300);
  expect(res.body).toEqual({ invoiceLink: expect.any(String) });
  const calls = t.fakeBot.callsOf('createInvoiceLink');
  expect(calls).toHaveLength(before + 1);
  return String(calls[calls.length - 1].body.payload);
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

const paymentByCharge = (charge: string) =>
  t.knex('payments').where({ telegram_payment_charge_id: charge }).first();

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

const paymentsOf = (u: TgUser) =>
  t.knex('payments').where({ payer_id: u.id }).orderBy('created_at', 'asc');

async function refundedRow(charge: string) {
  return waitFor(async () => {
    const row = await paymentByCharge(charge);
    return row?.status === 'refunded' ? row : null;
  }, 3000);
}

async function buyPremium(u: TgUser) {
  const payload = await invoicePayload(u, 'premium');
  const charge = nextCharge('premium');
  expect((await pay(u, payload, PREMIUM_PRICE, charge)).status).toBe(200);
  const row = await paymentByCharge(charge);
  return { payload, charge, paymentId: row.id as string };
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
      TmaPaymentsModule.forRoot({
        products: [
          premium,
          gated,
          limited,
          vip,
          broken,
          priced('fractional', 1.5),
          priced('free', 0),
          priced('negative', -5),
          refill,
        ],
        runWorker: false,
      }),
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  settled.length = 0;
  refunded.length = 0;
  limitedOpen = true;
  t.fakeBot.reset();
});

describe('onRefund runs only for settled payments', () => {
  it('second charge on a paid one_time invoice is refunded without onRefund', async () => {
    const u: TgUser = { id: 4001, first_name: 'Twice' };
    const first = await buyPremium(u);
    expect(settled).toEqual([first.paymentId]);
    const firstRow = await paymentByCharge(first.charge);
    expect(firstRow.settled_at).toBeInstanceOf(Date);

    const second = nextCharge('second');
    expect((await pay(u, first.payload, PREMIUM_PRICE, second)).status).toBe(200);

    const dup = await refundedRow(second);
    expect(dup.settled_at).toBeNull();
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      expect.objectContaining({ user_id: u.id, telegram_payment_charge_id: second }),
    ]);
    expect(refunded).toEqual([]);
    expect(settled).toEqual([first.paymentId]);
  });

  it('lock rejection is refunded without settle or onRefund', async () => {
    const u: TgUser = { id: 4002, first_name: 'Locked' };
    const payload = await invoicePayload(u, 'gated', 'closed');
    const charge = nextCharge('locked');
    expect((await pay(u, payload, GATED_PRICE, charge)).status).toBe(200);

    const row = await refundedRow(charge);
    expect(row).toMatchObject({ product_id: 'gated', target_id: 'closed', settled_at: null });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      expect.objectContaining({ user_id: u.id, telegram_payment_charge_id: charge }),
    ]);
    expect(settled).toEqual([]);
    expect(refunded).toEqual([]);
  });

  it('validate rejection at payment time is refunded without settle or onRefund', async () => {
    const u: TgUser = { id: 4003, first_name: 'Late' };
    const payload = await invoicePayload(u, 'limited');
    limitedOpen = false;
    const charge = nextCharge('limited');
    expect((await pay(u, payload, LIMITED_PRICE, charge)).status).toBe(200);

    const row = await refundedRow(charge);
    expect(row).toMatchObject({ product_id: 'limited', settled_at: null });
    expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
      expect.objectContaining({ user_id: u.id, telegram_payment_charge_id: charge }),
    ]);
    expect(settled).toEqual([]);
    expect(refunded).toEqual([]);
  });

  it('settled payment refunded through retry calls onRefund exactly once', async () => {
    const u: TgUser = { id: 4004, first_name: 'Settled' };
    const { charge, paymentId } = await buyPremium(u);
    expect((await paymentByCharge(charge)).settled_at).toBeInstanceOf(Date);
    await t.knex('payments').where({ id: paymentId }).update({ status: 'refund_pending' });

    await t.app.get(PaymentsService).retryPendingRefunds();
    await t.app.get(PaymentsService).retryPendingRefunds();

    const row = await paymentByCharge(charge);
    expect(row.status).toBe('refunded');
    expect(row.refunded_at).not.toBeNull();
    expect(refunded).toEqual([paymentId]);
    expect(
      t.fakeBot
        .callsOf('refundStarPayment')
        .filter((c) => c.body.telegram_payment_charge_id === charge),
    ).toHaveLength(1);
  });

  it('accepted repeatable product without settle is marked settled and its refund calls onRefund once', async () => {
    const u: TgUser = { id: 4005, first_name: 'Consumer' };
    const payload = await invoicePayload(u, 'refill');
    const charge = nextCharge('refill');
    expect((await pay(u, payload, REFILL_PRICE, charge)).status).toBe(200);

    const paid = await paymentByCharge(charge);
    expect(paid).toMatchObject({ product_id: 'refill', status: 'paid' });
    expect(paid.settled_at).toBeInstanceOf(Date);
    expect(await entitlement(u, 'refill')).toBeUndefined();

    await t.knex('payments').where({ id: paid.id }).update({ status: 'refund_pending' });
    await t.app.get(PaymentsService).retryPendingRefunds();
    await t.app.get(PaymentsService).retryPendingRefunds();

    expect((await paymentByCharge(charge)).status).toBe('refunded');
    expect(refunded).toEqual([paid.id]);
  });
});

describe('refund retry backoff', () => {
  it('21 permanently failing refunds do not starve a newer one', async () => {
    await t
      .knex('payments')
      .where({ status: 'refund_pending' })
      .update({ status: 'refunded', refunded_at: t.knex.fn.now() });

    const poisonUser = 4010;
    const goodUser = 4011;
    await t.knex('users').insert([
      { id: poisonUser, first_name: 'Poison' },
      { id: goodUser, first_name: 'Good' },
    ]);
    const base = Date.now() - 3_600_000;
    const poison = Array.from({ length: 21 }, (_, i) => `ch_poison_${i + 1}`);
    await t.knex('payments').insert(
      poison.map((charge, i) => ({
        payer_id: poisonUser,
        product_id: 'premium',
        amount_stars: PREMIUM_PRICE,
        invoice_payload: `premium:-:poison${String(i + 1).padStart(5, '0')}`,
        telegram_payment_charge_id: charge,
        status: 'refund_pending',
        created_at: new Date(base + i * 1000),
      })),
    );
    await t.knex('payments').insert({
      payer_id: goodUser,
      product_id: 'premium',
      amount_stars: PREMIUM_PRICE,
      invoice_payload: 'premium:-:goodNonce01',
      telegram_payment_charge_id: 'ch_good',
      status: 'refund_pending',
      created_at: new Date(base + 30_000),
    });
    t.fakeBot.respond('refundStarPayment', PROVIDER_DOWN, { times: 21 });
    const service = t.app.get(PaymentsService);

    await service.retryPendingRefunds();

    const charges = () =>
      t.fakeBot.callsOf('refundStarPayment').map((c) => c.body.telegram_payment_charge_id);
    expect(charges()).toEqual(poison.slice(0, 20));
    for (const charge of poison.slice(0, 20)) {
      const row = await paymentByCharge(charge);
      expect(row).toMatchObject({ status: 'refund_pending', refund_attempts: 1 });
      expect(row.refund_attempted_at).not.toBeNull();
    }
    expect(await paymentByCharge(poison[20])).toMatchObject({
      status: 'refund_pending',
      refund_attempts: 0,
      refund_attempted_at: null,
    });
    expect(await paymentByCharge('ch_good')).toMatchObject({
      status: 'refund_pending',
      refund_attempts: 0,
      refund_attempted_at: null,
    });

    await service.retryPendingRefunds();

    expect(charges()).toEqual([...poison, 'ch_good']);
    expect(await paymentByCharge('ch_good')).toMatchObject({ status: 'refunded' });
    expect(await paymentByCharge(poison[20])).toMatchObject({
      status: 'refund_pending',
      refund_attempts: 1,
    });
    for (const charge of poison.slice(0, 20)) {
      expect(await paymentByCharge(charge)).toMatchObject({
        status: 'refund_pending',
        refund_attempts: 1,
      });
    }
  });
});

describe('product pricing', () => {
  it('GET /api/products skips a product whose priceStars throws', async () => {
    const u: TgUser = { id: 4020, first_name: 'Shopper', language_code: 'en' };
    const res = await t.http.get('/api/products').set('Authorization', auth(u));
    expect(res.status).toBe(200);
    const ids = res.body.map((p: { id: string }) => p.id);
    expect(ids).not.toContain('broken');
    expect(
      res.body.filter((p: { id: string }) => ['premium', 'gated', 'limited', 'vip'].includes(p.id)),
    ).toEqual([
      {
        id: 'premium',
        kind: 'one_time',
        repeatable: false,
        priceStars: PREMIUM_PRICE,
        title: 'Premium',
        description: 'Premium access',
      },
      {
        id: 'gated',
        kind: 'one_time',
        repeatable: false,
        priceStars: GATED_PRICE,
        title: 'Gated',
        description: 'Gated target',
      },
      {
        id: 'limited',
        kind: 'one_time',
        repeatable: true,
        priceStars: LIMITED_PRICE,
        title: 'Limited',
        description: 'Limited offer',
      },
      {
        id: 'vip',
        kind: 'subscription',
        repeatable: false,
        priceStars: VIP_PRICE,
        title: 'VIP',
        description: 'VIP subscription',
      },
    ]);
  });

  it.each(['fractional', 'free', 'negative'])(
    'invoice for %s price → 409 PRODUCT_UNAVAILABLE without createInvoiceLink',
    async (productId) => {
      const u: TgUser = { id: 4021, first_name: 'Pricer' };
      expectError(await invoice(u, productId), 409, 'PRODUCT_UNAVAILABLE');
      expect(t.fakeBot.callsOf('createInvoiceLink')).toHaveLength(0);
    },
  );

  it('invoice when priceStars throws → 409 PRODUCT_UNAVAILABLE without createInvoiceLink', async () => {
    const u: TgUser = { id: 4022, first_name: 'Unlucky' };
    expectError(await invoice(u, 'broken'), 409, 'PRODUCT_UNAVAILABLE');
    expect(t.fakeBot.callsOf('createInvoiceLink')).toHaveLength(0);
  });
});

describe('subscription expires_at ordering', () => {
  it('a late first payment keeps the later expires_at of an earlier renewal', async () => {
    const u: TgUser = { id: 4030, first_name: 'OutOfOrder' };
    const payload = await invoicePayload(u, 'vip');
    const firstCharge = nextCharge('vip_first');
    const renewalCharge = nextCharge('vip_renewal');
    const firstUntil = nowSec() + PERIOD;
    const renewedUntil = firstUntil + PERIOD;

    expect(
      (
        await pay(u, payload, VIP_PRICE, renewalCharge, {
          subscriptionExpirationDate: renewedUntil,
          isRecurring: true,
          isFirstRecurring: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await pay(u, payload, VIP_PRICE, firstCharge, {
          subscriptionExpirationDate: firstUntil,
          isRecurring: true,
          isFirstRecurring: true,
        })
      ).status,
    ).toBe(200);

    expect(await paymentsOf(u)).toHaveLength(2);
    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({
      source: 'subscription',
      subscription_charge_id: firstCharge,
      canceled_at: null,
    });
    expect(sec(ent.expires_at)).toBe(renewedUntil);
    expect(t.fakeBot.callsOf('refundStarPayment')).toHaveLength(0);
  });

  it('renewal with no entitlement row and no first payment creates one from the renewal charge', async () => {
    const u: TgUser = { id: 4031, first_name: 'OnlyRenewal' };
    const payload = await invoicePayload(u, 'vip');
    const renewalCharge = nextCharge('vip_only_renewal');
    const until = nowSec() + PERIOD;

    expect(
      (
        await pay(u, payload, VIP_PRICE, renewalCharge, {
          subscriptionExpirationDate: until,
          isRecurring: true,
          isFirstRecurring: false,
        })
      ).status,
    ).toBe(200);

    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({
      source: 'subscription',
      subscription_charge_id: renewalCharge,
      canceled_at: null,
    });
    expect(sec(ent.expires_at)).toBe(until);
  });

  it('renewal after the entitlement row is gone recreates it with the first charge', async () => {
    const u: TgUser = { id: 4032, first_name: 'Recreated' };
    const payload = await invoicePayload(u, 'vip');
    const firstCharge = nextCharge('vip_first');
    const firstUntil = nowSec() + PERIOD;
    expect(
      (
        await pay(u, payload, VIP_PRICE, firstCharge, {
          subscriptionExpirationDate: firstUntil,
          isRecurring: true,
          isFirstRecurring: true,
        })
      ).status,
    ).toBe(200);
    await t.knex('entitlements').where({ user_id: u.id, product_id: 'vip' }).del();

    const renewalCharge = nextCharge('vip_renewal');
    const renewedUntil = firstUntil + PERIOD;
    expect(
      (
        await pay(u, payload, VIP_PRICE, renewalCharge, {
          subscriptionExpirationDate: renewedUntil,
          isRecurring: true,
          isFirstRecurring: false,
        })
      ).status,
    ).toBe(200);

    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({
      source: 'subscription',
      subscription_charge_id: firstCharge,
      canceled_at: null,
    });
    expect(sec(ent.expires_at)).toBe(renewedUntil);
  });
});
