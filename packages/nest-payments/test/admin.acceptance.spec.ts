import {
  TmaCoreModule,
  composeMigrations,
  migrations as coreMigrations,
} from '@pctea/tma-nest-core';
import { TmaBotModule, migrations as botMigrations } from '@pctea/tma-nest-bot';
import {
  Product,
  TmaPaymentsModule,
  migrations as paymentsMigrations,
} from '@pctea/tma-nest-payments';
import { createTestApp, postWebhook, updates } from '@pctea/tma-testing';

jest.setTimeout(60_000);

type TestApp = Awaited<ReturnType<typeof createTestApp>>;
type TgUser = { id: number; first_name: string };

const BOT_TOKEN = '123456:PAY-ADMIN';
const PATH_TOKEN = 'pay-admin-path-token-01';
const SECRET = 'pay-admin-secret-0123456789';
const HOOK = { pathToken: PATH_TOKEN, secret: SECRET };
const ADMIN: TgUser = { id: 5001, first_name: 'Admin' };
const PREMIUM_PRICE = 50;
const DAY_MS = 86_400_000;

const premium: Product = {
  id: 'premium',
  kind: 'one_time',
  priceStars: () => PREMIUM_PRICE,
  title: () => 'Premium',
  description: () => 'Premium access',
};

const extra: Product = {
  id: 'extra',
  kind: 'one_time',
  priceStars: () => 10,
  title: () => 'Extra',
  description: () => 'Extra access',
};

let t: TestApp;
let seq = 0;

const auth = (u: TgUser) => 'tma ' + t.tokenFor(u);

function expectError(res: { status: number; body: any }, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ statusCode: status, code });
}

const entitlement = (u: TgUser, productId: string) =>
  t.knex('entitlements').where({ user_id: u.id, product_id: productId }).first();

const grant = (u: TgUser, body: object) =>
  t.http.post(`/api/admin/users/${u.id}/entitlements`).set('Authorization', auth(ADMIN)).send(body);

const listPayments = (query: Record<string, string>) =>
  t.http.get('/api/admin/payments').query(query).set('Authorization', auth(ADMIN));

const estimate = (filters: Record<string, unknown>) =>
  t.http
    .post('/api/admin/broadcasts/estimate')
    .set('Authorization', auth(ADMIN))
    .send({ audience: { filters } });

const addUser = (u: TgUser) => t.knex('users').insert({ id: u.id, first_name: u.first_name });

async function addPayments(
  u: TgUser,
  rows: Array<{ status?: string; createdAt: Date }>,
): Promise<string[]> {
  const inserted: { id: string }[] = await t
    .knex('payments')
    .insert(
      rows.map((r) => {
        const n = ++seq;
        return {
          payer_id: u.id,
          product_id: 'premium',
          amount_stars: PREMIUM_PRICE,
          invoice_payload: `premium:-:seed${n}`,
          telegram_payment_charge_id: `ch_admin_seed_${n}`,
          status: r.status ?? 'paid',
          created_at: r.createdAt,
        };
      }),
    )
    .returning('id');
  return inserted.map((r) => r.id);
}

async function buyPremium(u: TgUser): Promise<void> {
  const inv = await t.http
    .post('/api/payments/invoice')
    .set('Authorization', auth(u))
    .send({ productId: 'premium' });
  expect(inv.status).toBe(200);
  const calls = t.fakeBot.callsOf('createInvoiceLink');
  const payload = String(calls[calls.length - 1].body.payload);
  const res = await postWebhook(
    t.http,
    updates.successfulPayment({
      payload,
      chargeId: `ch_admin_buy_${++seq}`,
      totalAmount: PREMIUM_PRICE,
      from: u,
    }),
    HOOK,
  );
  expect(res.status).toBe(200);
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
        botUsername: 'admin_pay_bot',
        webappUrl: 'https://admin-pay.example.com',
        webhookPathToken: PATH_TOKEN,
        webhookSecret: SECRET,
        apiRoot: ctx.apiRoot,
        runWorker: false,
      }),
      TmaPaymentsModule.forRoot({ products: [premium, extra], runWorker: false }),
    ],
  });
});

afterAll(async () => {
  await t?.close();
});

beforeEach(() => {
  t.fakeBot.reset();
});

describe('admin grant', () => {
  it('grant with expiresAt over a permanent one_time purchase → 409 ALREADY_OWNED, purchase kept', async () => {
    const buyer: TgUser = { id: 5101, first_name: 'Owner' };
    await buyPremium(buyer);
    expect(await entitlement(buyer, 'premium')).toMatchObject({
      source: 'one_time',
      expires_at: null,
    });

    expectError(
      await grant(buyer, {
        productId: 'premium',
        expiresAt: new Date(Date.now() + 7 * DAY_MS).toISOString(),
      }),
      409,
      'ALREADY_OWNED',
    );

    expect(await entitlement(buyer, 'premium')).toMatchObject({
      source: 'one_time',
      expires_at: null,
    });
    expect(
      await t
        .knex('audit_events')
        .where({ action: 'entitlement.grant', target_id: String(buyer.id) }),
    ).toHaveLength(0);
  });

  it('permanent grant over a permanent one_time purchase → 409 ALREADY_OWNED; refund then revokes access', async () => {
    const buyer: TgUser = { id: 5104, first_name: 'OwnerForever' };
    await buyPremium(buyer);

    expectError(await grant(buyer, { productId: 'premium' }), 409, 'ALREADY_OWNED');
    expect(await entitlement(buyer, 'premium')).toMatchObject({ source: 'one_time', expires_at: null });

    const payment = await t.knex('payments').where({ payer_id: buyer.id }).first();
    const res = await t.http
      .post(`/api/admin/payments/${payment.id}/refund`)
      .set('Authorization', auth(ADMIN));
    expect(res.status).toBe(200);
    expect(await entitlement(buyer, 'premium')).toBeUndefined();
  });

  it('a purchase committed while the grant waits on the upsert keeps the paid row → 409 ALREADY_OWNED', async () => {
    const buyer: TgUser = { id: 5105, first_name: 'Racer' };
    await addUser(buyer);

    const purchase = await t.knex.transaction();
    await purchase('entitlements').insert({ user_id: buyer.id, product_id: 'premium', source: 'one_time' });

    const pending = grant(buyer, { productId: 'premium' }).then((res) => res);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const waiting = await t
        .knex('pg_stat_activity')
        .where({ datname: t.knex.raw('current_database()'), wait_event_type: 'Lock' })
        .andWhere('query', 'ilike', 'insert into "entitlements"%')
        .count<{ count: string }[]>('* as count');
      if (Number(waiting[0].count) > 0) break;
      if (Date.now() > deadline) throw new Error('grant never blocked on the entitlement upsert');
      await new Promise((r) => setTimeout(r, 20));
    }
    await purchase.commit();

    expectError(await pending, 409, 'ALREADY_OWNED');
    expect(await entitlement(buyer, 'premium')).toMatchObject({ source: 'one_time', expires_at: null });
    expect(
      await t
        .knex('audit_events')
        .where({ action: 'entitlement.grant', target_id: String(buyer.id) }),
    ).toHaveLength(0);
  });

  it('grant with a past expiresAt → 400 VALIDATION, nothing written', async () => {
    const u: TgUser = { id: 5102, first_name: 'Past' };
    await addUser(u);

    expectError(
      await grant(u, {
        productId: 'premium',
        expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
      }),
      400,
      'VALIDATION',
    );

    expect(await entitlement(u, 'premium')).toBeUndefined();
    expect(
      await t.knex('audit_events').where({ action: 'entitlement.grant', target_id: String(u.id) }),
    ).toHaveLength(0);
  });

  it('grant with a future expiresAt on a user without the product writes source=grant', async () => {
    const u: TgUser = { id: 5103, first_name: 'Future' };
    await addUser(u);
    const expiresAt = new Date(Date.now() + 7 * DAY_MS);

    const res = await grant(u, { productId: 'premium', expiresAt: expiresAt.toISOString() });

    expect(res.status).toBe(200);
    const row = await entitlement(u, 'premium');
    expect(row.source).toBe('grant');
    expect(new Date(row.expires_at).getTime()).toBe(expiresAt.getTime());
  });
});

describe('GET /api/admin/payments', () => {
  const payer: TgUser = { id: 5201, first_name: 'Pager' };
  const other: TgUser = { id: 5202, first_name: 'Other' };
  let expected: string[] = [];
  let refundedIds: string[] = [];

  beforeAll(async () => {
    await addUser(payer);
    await addUser(other);
    const base = Date.UTC(2026, 0, 1, 12, 0, 0);
    const rows = Array.from({ length: 120 }, (_, i) => ({
      status: i % 4 === 0 ? 'refunded' : 'paid',
      createdAt: new Date(base + Math.floor(i / 7) * 1000),
    }));
    const ids = await addPayments(payer, rows);
    await addPayments(other, [
      { createdAt: new Date(base + 500) },
      { createdAt: new Date(base + 60_000) },
    ]);
    const ordered = ids
      .map((id, i) => ({ id, at: rows[i].createdAt.getTime(), status: rows[i].status }))
      .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
    expected = ordered.map((r) => r.id);
    refundedIds = ordered.filter((r) => r.status === 'refunded').map((r) => r.id);
  });

  async function collect(
    query: Record<string, string>,
  ): Promise<{ ids: string[]; pages: number[] }> {
    const ids: string[] = [];
    const pages: number[] = [];
    let cursor: string | null = null;
    do {
      const res = await listPayments(cursor ? { ...query, cursor } : query);
      expect(res.status).toBe(200);
      pages.push(res.body.items.length);
      ids.push(...res.body.items.map((p: { id: string }) => p.id));
      cursor = res.body.nextCursor;
    } while (cursor !== null && pages.length < 10);
    return { ids, pages };
  }

  it('userId filter pages by (created_at, id) desc without skips or repeats; last page has nextCursor null', async () => {
    const { ids, pages } = await collect({ userId: String(payer.id) });

    expect(pages).toEqual([50, 50, 20]);
    expect(ids).toEqual(expected);
  });

  it('status filter returns only rows with that status, paged', async () => {
    const { ids } = await collect({ userId: String(payer.id), status: 'refunded' });

    expect(ids).toEqual(refundedIds);
  });

  it('without userId lists every payer', async () => {
    const res = await listPayments({});

    expect(res.status).toBe(200);
    const payers = new Set(res.body.items.map((p: { payerId: number }) => p.payerId));
    expect(payers).toContain(other.id);
  });

  it('bad userId, status or cursor → 400 VALIDATION', async () => {
    expectError(await listPayments({ userId: 'abc' }), 400, 'VALIDATION');
    expectError(await listPayments({ status: 'settled' }), 400, 'VALIDATION');
    expectError(await listPayments({ cursor: 'nope' }), 400, 'VALIDATION');
  });
});

describe('POST /api/admin/payments/reconcile offset', () => {
  const reconcile = (offset?: string) =>
    t.http
      .post('/api/admin/payments/reconcile')
      .query(offset === undefined ? {} : { offset })
      .set('Authorization', auth(ADMIN));

  it('bad offset → 400 VALIDATION without calling getStarTransactions', async () => {
    for (const offset of ['abc', '-1', '1.5', '1234567890']) {
      expectError(await reconcile(offset), 400, 'VALIDATION');
    }
    expect(t.fakeBot.callsOf('getStarTransactions')).toHaveLength(0);
  });

  it('numeric offset is passed to getStarTransactions with limit 100', async () => {
    const res = await reconcile('200');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ offset: 200, checked: 0, missing: [], nextOffset: null });
    expect(t.fakeBot.callsOf('getStarTransactions').map((c) => c.body)).toEqual([
      { offset: 200, limit: 100 },
    ]);
  });
});

describe('entitlement audience filter', () => {
  it('bad product id → 400 VALIDATION', async () => {
    for (const value of ['Bad-Id!', 42, '', 'x'.repeat(25)]) {
      expectError(await estimate({ entitlement: value }), 400, 'VALIDATION');
    }
  });

  it('counts only users with an active entitlement on that product', async () => {
    const active: TgUser = { id: 5301, first_name: 'Active' };
    const expired: TgUser = { id: 5302, first_name: 'Expired' };
    const otherProduct: TgUser = { id: 5303, first_name: 'OtherProduct' };
    for (const u of [active, expired, otherProduct]) await addUser(u);
    const before = (await estimate({ entitlement: 'extra' })).body.total;
    await t.knex('entitlements').insert([
      { user_id: active.id, product_id: 'extra', source: 'grant', expires_at: null },
      {
        user_id: expired.id,
        product_id: 'extra',
        source: 'grant',
        expires_at: new Date(Date.now() - DAY_MS),
      },
      { user_id: otherProduct.id, product_id: 'premium', source: 'grant', expires_at: null },
    ]);

    const res = await estimate({ entitlement: 'extra' });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(before + 1);
  });
});

describe('admin user card payments', () => {
  it('shows the last 20 payments of that user, newest first, and their entitlements', async () => {
    const u: TgUser = { id: 5401, first_name: 'Card' };
    const stranger: TgUser = { id: 5402, first_name: 'Stranger' };
    await addUser(u);
    await addUser(stranger);
    const base = Date.UTC(2026, 1, 1, 12, 0, 0);
    const ids = await addPayments(
      u,
      Array.from({ length: 25 }, (_, i) => ({ createdAt: new Date(base + i * 1000) })),
    );
    await addPayments(stranger, [{ createdAt: new Date(base + 99_000) }]);
    await t.knex('entitlements').insert([
      { user_id: u.id, product_id: 'premium', source: 'one_time', expires_at: null },
      { user_id: stranger.id, product_id: 'extra', source: 'grant', expires_at: null },
    ]);

    const res = await t.http.get(`/api/admin/users/${u.id}`).set('Authorization', auth(ADMIN));

    expect(res.status).toBe(200);
    const card = res.body.cards.payments;
    expect(card.payments.map((p: { id: string }) => p.id)).toEqual(ids.slice(5).reverse());
    expect(card.entitlements).toEqual([
      expect.objectContaining({ productId: 'premium', source: 'one_time', expiresAt: null }),
    ]);
  });
});
