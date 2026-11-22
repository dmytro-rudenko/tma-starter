import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@pctea/tma/nest-core';
import { TmaBotModule, migrations as botMigrations } from '@pctea/tma/nest-bot';
import { createTestApp, postWebhook, updates, waitFor } from '@pctea/tma/testing';
import { migrations as paymentsMigrations } from './migrations';
import { TmaPaymentsModule } from './payments.module';
import type { Product } from './product';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const PATH_TOKEN = 'refund-worker-path-01';
const SECRET = 'refund-worker-secret-0123456789';
const PRICE = 40;

const premium: Product = {
  id: 'premium',
  kind: 'one_time',
  priceStars: () => PRICE,
  title: () => 'Premium',
  description: () => 'Premium access',
};

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    botToken: '123456:REFUND-WORKER',
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
        botUsername: 'refund_worker_bot',
        webappUrl: 'https://refund-worker.example.com',
        webhookPathToken: PATH_TOKEN,
        webhookSecret: SECRET,
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
      TmaPaymentsModule.forRoot({ products: [premium], runWorker: true, refundRetryIntervalMs: 100 }),
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

it('with runWorker the retry timer refunds a refund_pending payment on its own', async () => {
  const u = { id: 8201, first_name: 'Worker' };
  const invoice = await t.http
    .post('/api/payments/invoice')
    .set('Authorization', 'tma ' + t.tokenFor(u))
    .send({ productId: 'premium' });
  expect(invoice.status).toBe(200);
  const payload = String(t.fakeBot.callsOf('createInvoiceLink')[0].body.payload);
  const charge = 'ch_refund_worker_1';
  const paid = await postWebhook(
    t.http,
    updates.successfulPayment({ payload, chargeId: charge, totalAmount: PRICE, from: u }),
    { pathToken: PATH_TOKEN, secret: SECRET },
  );
  expect(paid.status).toBe(200);
  await t.knex('payments').where({ telegram_payment_charge_id: charge }).update({ status: 'refund_pending' });

  const row = await waitFor(async () => {
    const r = await t.knex('payments').where({ telegram_payment_charge_id: charge }).first();
    return r.status === 'refunded' ? r : null;
  }, 3000);

  expect(row.refunded_at).not.toBeNull();
  expect(t.fakeBot.callsOf('refundStarPayment').map((c) => c.body)).toEqual([
    { user_id: u.id, telegram_payment_charge_id: charge },
  ]);
});
