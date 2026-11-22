import {
  TmaCoreModule,
  UsersService,
  composeMigrations,
  migrations as coreMigrations,
} from '@dmytro-rudenko/tma-nest-core';
import { TmaBotModule, migrations as botMigrations } from '@dmytro-rudenko/tma-nest-bot';
import { createTestApp } from '@dmytro-rudenko/tma-testing';
import { makePayload } from './invoice-payload';
import { migrations as paymentsMigrations } from './migrations';
import { PaidInput, PaidOutcome, PaymentRecorder } from './payment-recorder';
import { TmaPaymentsModule } from './payments.module';
import type { PaymentRow, Product } from './product';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string };

const PERIOD_MS = 2_592_000_000;

const settled: string[] = [];
const validated: { userId: number; targetId?: string }[] = [];
let validateResult = true;

const record = async (_trx: unknown, payment: PaymentRow) => {
  settled.push(payment.id);
};

const base = (id: string): Pick<Product, 'id' | 'priceStars' | 'title' | 'description'> => ({
  id,
  priceStars: () => 10,
  title: () => id,
  description: () => `${id} product`,
});

const premium: Product = { ...base('premium'), kind: 'one_time', settle: record };
const refill: Product = { ...base('refill'), kind: 'one_time', repeatable: true, settle: record };
const seat: Product = {
  ...base('seat'),
  kind: 'one_time',
  lock: async (_trx, targetId) => (targetId === 'open' ? { targetId } : null),
  settle: record,
};
const limited: Product = {
  ...base('limited'),
  kind: 'one_time',
  validate: ({ userId, targetId }) => {
    validated.push({ userId, targetId });
    return validateResult;
  },
  settle: record,
};
const vip: Product = { ...base('vip'), kind: 'subscription' };

let t: TestApp;
let recorder: PaymentRecorder;
let seq = 0;

const nextCharge = (tag: string) => `ch_recorder_${tag}_${++seq}`;

function oneTime(u: TgUser, product: Product, targetId?: string): PaidInput {
  return {
    product,
    targetId,
    payer: u,
    amountStars: 10,
    invoicePayload: makePayload(product.id, targetId),
    chargeId: nextCharge(product.id),
    recurrence: 'none',
    expiresAt: null,
    subscriptionChargeId: null,
  };
}

function subscription(
  u: TgUser,
  invoicePayload: string,
  recurrence: 'first' | 'renewal',
  expiresAt: Date,
): PaidInput {
  const chargeId = nextCharge(`vip_${recurrence}`);
  return {
    product: vip,
    payer: u,
    amountStars: 10,
    invoicePayload,
    chargeId,
    recurrence,
    expiresAt,
    subscriptionChargeId: recurrence === 'first' ? chargeId : null,
  };
}

const settle = (input: PaidInput): Promise<PaidOutcome> =>
  t.knex.transaction((trx) => recorder.settle(trx, input));

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

const inFuture = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000);

beforeAll(async () => {
  t = await createTestApp({
    botToken: '123456:RECORDER-TEST',
    migrations: composeMigrations(coreMigrations, botMigrations, paymentsMigrations),
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
        botUsername: 'recorder_test_bot',
        webappUrl: 'https://recorder.example.com',
        webhookPathToken: 'recorder-path-token-01',
        webhookSecret: 'recorder-secret-0123456789',
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
      TmaPaymentsModule.forRoot({ products: [premium, refill, seat, limited, vip], runWorker: false }),
    ],
  });
  recorder = new PaymentRecorder(t.app.get(UsersService));
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  settled.length = 0;
  validated.length = 0;
  validateResult = true;
});

describe('one_time acceptance', () => {
  it('targeted purchase accepted by lock is paid and settled without an entitlement', async () => {
    const u: TgUser = { id: 9101, first_name: 'Open' };

    const outcome = await settle(oneTime(u, seat, 'open'));

    expect(outcome).toMatchObject({ kind: 'settled', renewal: false });
    const payment = (outcome as { payment: PaymentRow }).payment;
    expect(payment).toMatchObject({ product_id: 'seat', target_id: 'open', status: 'paid' });
    expect(payment.settled_at).toBeInstanceOf(Date);
    expect(settled).toEqual([payment.id]);
    expect(await entitlement(u, 'seat')).toBeUndefined();
  });

  it('targeted purchase rejected by lock is refund_pending and not settled', async () => {
    const u: TgUser = { id: 9102, first_name: 'Closed' };

    const outcome = await settle(oneTime(u, seat, 'closed'));

    expect(outcome.kind).toBe('refund');
    const payment = (outcome as { payment: PaymentRow }).payment;
    expect(payment).toMatchObject({ target_id: 'closed', status: 'refund_pending', settled_at: null });
    expect(settled).toEqual([]);
    expect(await entitlement(u, 'seat')).toBeUndefined();
  });

  it('validate sees the payer and target; true settles the purchase', async () => {
    const u: TgUser = { id: 9103, first_name: 'Valid' };

    const outcome = await settle(oneTime(u, limited, 'slot'));

    expect(validated).toEqual([{ userId: u.id, targetId: 'slot' }]);
    expect(outcome.kind).toBe('settled');
    expect(settled).toHaveLength(1);
  });

  it('validate returning false makes the purchase refund_pending without settle', async () => {
    const u: TgUser = { id: 9104, first_name: 'Invalid' };
    validateResult = false;

    const outcome = await settle(oneTime(u, limited));

    expect(validated).toEqual([{ userId: u.id, targetId: undefined }]);
    expect(outcome.kind).toBe('refund');
    expect((outcome as { payment: PaymentRow }).payment).toMatchObject({
      status: 'refund_pending',
      settled_at: null,
    });
    expect(settled).toEqual([]);
    expect(await entitlement(u, 'limited')).toBeUndefined();
  });
});

describe('one_time entitlement', () => {
  it('untargeted non-repeatable purchase writes a permanent one_time entitlement', async () => {
    const u: TgUser = { id: 9111, first_name: 'Owner' };

    expect((await settle(oneTime(u, premium))).kind).toBe('settled');

    expect(await entitlement(u, 'premium')).toMatchObject({
      source: 'one_time',
      expires_at: null,
      subscription_charge_id: null,
    });
  });

  it('repeatable purchase settles without an entitlement', async () => {
    const u: TgUser = { id: 9112, first_name: 'Consumer' };

    expect((await settle(oneTime(u, refill))).kind).toBe('settled');

    expect(settled).toHaveLength(1);
    expect(await entitlement(u, 'refill')).toBeUndefined();
  });
});

describe('duplicate charge', () => {
  it('a paid charge delivered again is a duplicate and settles once', async () => {
    const u: TgUser = { id: 9121, first_name: 'Again' };
    const input = oneTime(u, premium);
    expect((await settle(input)).kind).toBe('settled');

    expect(await settle(input)).toEqual({ kind: 'duplicate' });
    expect(settled).toHaveLength(1);
  });

  it('a refund_pending charge delivered again is handed back for refund', async () => {
    const u: TgUser = { id: 9122, first_name: 'Rejected' };
    const input = oneTime(u, seat, 'closed');
    const first = (await settle(input)) as { payment: PaymentRow };

    const again = await settle(input);

    expect(again.kind).toBe('refund');
    expect((again as { payment: PaymentRow }).payment).toMatchObject({
      id: first.payment.id,
      status: 'refund_pending',
    });
  });
});

describe('subscription', () => {
  it('first payment reports renewal false, renewal payment reports renewal true', async () => {
    const u: TgUser = { id: 9131, first_name: 'Subscriber' };
    const payload = makePayload('vip');

    const first = await settle(subscription(u, payload, 'first', inFuture(PERIOD_MS)));
    const renewal = await settle(subscription(u, payload, 'renewal', inFuture(2 * PERIOD_MS)));

    expect(first).toMatchObject({ kind: 'settled', renewal: false });
    expect(renewal).toMatchObject({ kind: 'settled', renewal: true });
  });

  it('renewal without an entitlement row or an earlier payment takes the renewal charge', async () => {
    const u: TgUser = { id: 9132, first_name: 'OnlyRenewal' };
    const until = inFuture(PERIOD_MS);
    const input = subscription(u, makePayload('vip'), 'renewal', until);

    expect(await settle(input)).toMatchObject({ kind: 'settled', renewal: true });

    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({
      source: 'subscription',
      subscription_charge_id: input.chargeId,
      canceled_at: null,
    });
    expect(new Date(ent.expires_at).getTime()).toBe(until.getTime());
  });

  it('renewal after the entitlement row is gone restores it with the first recurring charge', async () => {
    const u: TgUser = { id: 9133, first_name: 'Restored' };
    const payload = makePayload('vip');
    const first = subscription(u, payload, 'first', inFuture(PERIOD_MS));
    await settle(first);
    await t.knex('entitlements').where({ user_id: u.id, product_id: 'vip' }).del();
    const until = inFuture(2 * PERIOD_MS);

    await settle(subscription(u, payload, 'renewal', until));

    const ent = await entitlement(u, 'vip');
    expect(ent).toMatchObject({ source: 'subscription', subscription_charge_id: first.chargeId });
    expect(new Date(ent.expires_at).getTime()).toBe(until.getTime());
  });
});
