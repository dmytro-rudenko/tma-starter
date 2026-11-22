import { installFakeWebApp } from 'tma-starter/testing/dom';
import { TmaProvider, createQueryClient } from 'tma-starter/web/react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { AdminUserSheet } from './AdminUserSheet';

interface Call {
  method: string;
  path: string;
}

const BOT_BLOCKED_AT = '2026-10-15T09:30:00.000Z';
const VIP_EXPIRES_AT = new Date(Date.now() + 90 * 86_400_000).toISOString();

const ME = {
  id: 1,
  firstName: 'Admin',
  username: 'admin',
  language: 'uk',
  theme: 'system',
  isAdmin: true,
  adminSource: 'env',
};

const PAID = {
  id: 'pay_1',
  payerId: 42,
  productId: 'premium',
  targetId: null,
  amountStars: 250,
  chargeId: 'ch_1',
  isRecurring: false,
  subscriptionExpiresAt: null,
  status: 'paid',
  settledAt: '2026-10-20T10:00:00.000Z',
  refundedAt: null,
  refundAttempts: 0,
  createdAt: '2026-10-20T10:00:00.000Z',
};

const REFUNDED = {
  ...PAID,
  id: 'pay_2',
  amountStars: 100,
  chargeId: 'ch_2',
  status: 'refunded',
  refundedAt: '2026-10-11T10:00:00.000Z',
  createdAt: '2026-10-10T10:00:00.000Z',
};

const PENDING = {
  ...PAID,
  id: 'pay_3',
  amountStars: 75,
  chargeId: 'ch_3',
  status: 'refund_pending',
  refundAttempts: 1,
  createdAt: '2026-10-05T10:00:00.000Z',
};

const DETAIL = {
  id: 42,
  firstName: 'Olena',
  username: 'olen',
  language: 'uk',
  theme: 'system',
  isAdmin: false,
  adminSource: null,
  blockedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  adminGrantedAt: null,
  adminGrantedBy: null,
  botBlockedAt: BOT_BLOCKED_AT,
  cards: {
    bot: { botBlockedAt: BOT_BLOCKED_AT },
    payments: {
      payments: [PAID, REFUNDED],
      entitlements: [
        { productId: 'premium', source: 'one_time', expiresAt: null, canceled: false },
        { productId: 'vip', source: 'subscription', expiresAt: VIP_EXPIRES_AT, canceled: true },
        {
          productId: 'legacy_pass',
          source: 'grant',
          expiresAt: '2025-01-01T00:00:00.000Z',
          canceled: false,
        },
      ],
    },
  },
};

const PRODUCTS = [
  {
    id: 'premium',
    kind: 'one_time',
    repeatable: false,
    priceStars: 250,
    title: 'Premium',
    description: 'p',
  },
  {
    id: 'vip',
    kind: 'subscription',
    repeatable: false,
    priceStars: 500,
    title: 'VIP',
    description: 'v',
  },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(detail: unknown = DETAIL): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push({ method, path });
      if (path === '/api/me') return json(200, ME);
      if (path === '/api/products') return json(200, PRODUCTS);
      if (path === '/api/admin/users/42' && method === 'GET') return json(200, detail);
      if (path === '/api/admin/users/42/block' && method === 'DELETE')
        return json(200, { ...(detail as object), blockedAt: null });
      if (path === '/api/admin/payments/pay_3/refund' && method === 'POST')
        return json(200, {
          ...PENDING,
          status: 'refunded',
          refundedAt: '2026-11-06T00:00:00.000Z',
        });
      if (path === '/api/admin/payments/pay_1/refund' && method === 'POST')
        return json(200, { ...PAID, status: 'refunded', refundedAt: '2026-11-06T00:00:00.000Z' });
      if (path === '/api/admin/users/42/entitlements/premium' && method === 'DELETE')
        return new Response(null, { status: 204 });
      return json(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
        code: 'HTTP_404',
      });
    }),
  );
  return calls;
}

function renderSheet() {
  const qc = createQueryClient();
  return render(
    <TmaProvider client={qc} i18n={i18n}>
      <AdminUserSheet id={42} />
    </TmaProvider>,
  );
}

async function block(title: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title });
  const section = heading.closest('section');
  expect(section, `<section> around the "${title}" heading`).not.toBeNull();
  return section as HTMLElement;
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

const sent = (calls: Call[], method: string) =>
  calls.filter((c) => c.method === method).map((c) => c.path);

beforeEach(async () => {
  localStorage.clear();
  installFakeWebApp(window);
  await i18n.changeLanguage('uk');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { Telegram?: unknown }).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('AdminUserSheet: cards.bot', () => {
  it('the «Бот» block shows botBlockedAt from cards.bot', async () => {
    stubApi();
    renderSheet();
    const bot = await block('Бот');
    expect(bot.textContent).toContain(day(BOT_BLOCKED_AT));
  });
});

describe('AdminUserSheet: cards.payments', () => {
  it('the «Платежі» block lists every payment; only a paid one has «Повернути»', async () => {
    stubApi();
    renderSheet();
    const payments = await block('Платежі');
    const rows = within(payments).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('250');
    expect(within(rows[0]!).getByRole('button', { name: 'Повернути' })).toBeTruthy();
    expect(rows[1]!.textContent).toContain('100');
    expect(within(rows[1]!).queryByRole('button', { name: 'Повернути' })).toBeNull();
  });

  it('«Повернути» asks through AdminConfirm, then POSTs the refund for that payment', async () => {
    const calls = stubApi();
    renderSheet();
    const payments = await block('Платежі');
    const [paid] = within(payments).getAllByRole('listitem');
    fireEvent.click(within(paid!).getByRole('button', { name: 'Повернути' }));
    expect(sent(calls, 'POST')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повернути' }));
    await waitFor(() => expect(sent(calls, 'POST')).toEqual(['/api/admin/payments/pay_1/refund']));
  });

  it('the «Доступи» block lists active entitlements with source, expiry and the «скасовано» mark', async () => {
    stubApi();
    renderSheet();
    const access = await block('Доступи');
    const rows = within(access).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/premium/i);
    expect(rows[0]!.textContent).not.toContain('скасовано');
    expect(rows[1]!.textContent).toMatch(/vip/i);
    expect(rows[1]!.textContent).toContain(day(VIP_EXPIRES_AT));
    expect(rows[1]!.textContent).toContain('скасовано');
    expect(access.textContent).not.toMatch(/legacy_pass/);
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: 'Відкликати' })).toBeTruthy();
    }
  });

  it('«Відкликати» asks through AdminConfirm, then DELETEs that entitlement', async () => {
    const calls = stubApi();
    renderSheet();
    const access = await block('Доступи');
    const [premium] = within(access).getAllByRole('listitem');
    fireEvent.click(within(premium!).getByRole('button', { name: 'Відкликати' }));
    expect(sent(calls, 'DELETE')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Відкликати' }));
    await waitFor(() =>
      expect(sent(calls, 'DELETE')).toEqual(['/api/admin/users/42/entitlements/premium']),
    );
  });
});

const withPayments = (payments: unknown[]) => ({
  ...DETAIL,
  cards: { ...DETAIL.cards, payments: { ...DETAIL.cards.payments, payments } },
});

describe('AdminUserSheet: header actions', () => {
  it('«Розблокувати» asks through AdminConfirm before DELETE …/block', async () => {
    const calls = stubApi({ ...DETAIL, blockedAt: '2026-11-01T00:00:00.000Z' });
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Розблокувати' }));
    expect(sent(calls, 'DELETE')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Розблокувати' }));
    await waitFor(() => expect(sent(calls, 'DELETE')).toEqual(['/api/admin/users/42/block']));
  });
});

describe('AdminUserSheet: refund retry', () => {
  it('a refund_pending payment offers a retry through AdminConfirm', async () => {
    const calls = stubApi(withPayments([PENDING]));
    renderSheet();
    const payments = await block('Платежі');
    const [row] = within(payments).getAllByRole('listitem');
    fireEvent.click(within(row!).getByRole('button', { name: 'Повторити повернення' }));
    expect(sent(calls, 'POST')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Повторити повернення' }));
    await waitFor(() => expect(sent(calls, 'POST')).toEqual(['/api/admin/payments/pay_3/refund']));
  });
});

describe('AdminUserSheet: grant access', () => {
  it('the expiry date cannot be set earlier than tomorrow', async () => {
    stubApi();
    renderSheet();
    const input = (await screen.findByLabelText("Діє до (необов'язково)")) as HTMLInputElement;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(input.min).toBe(
      `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`,
    );
  });
});
