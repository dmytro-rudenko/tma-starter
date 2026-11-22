import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@dmytro-rudenko/tma-web/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { getStack, LayerContext, pop, push, reset, type Entry } from '../../state/stack';
import { PaywallSheet } from './PaywallSheet';
import { PremiumBlock } from './PremiumBlock';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const PREMIUM = {
  id: 'premium',
  kind: 'subscription',
  repeatable: false,
  priceStars: 250,
  title: 'Преміум',
  description: 'Доступ на 30 днів',
};

const ENTITLEMENT = (productId: string) => ({
  productId,
  source: 'subscription',
  expiresAt: '2027-01-15T00:00:00.000Z',
  canceled: false,
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(entitlements: unknown[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (path === '/api/products') return json(200, [PREMIUM]);
      if (path === '/api/entitlements') return json(200, entitlements);
      if (path === '/api/premium/content')
        return json(200, { items: ['Ексклюзивний гайд', 'Закрита добірка'] });
      if (path === '/api/payments/invoice' && method === 'POST')
        return json(200, { invoiceLink: 'https://t.me/$inv1' });
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

function renderUi(ui: React.ReactNode) {
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      {ui}
    </TmaProvider>,
  );
}

function renderPaywall(): Entry {
  const self: Entry = { kind: 'paywall', props: {} };
  push(self);
  renderUi(
    <LayerContext.Provider value={{ index: 0, isTop: true, entry: self }}>
      <PaywallSheet />
    </LayerContext.Provider>,
  );
  return self;
}

const hit = (calls: Call[], path: string) => calls.filter((c) => c.path === path);

beforeEach(async () => {
  localStorage.clear();
  reset();
  installFakeWebApp(window);
  await i18n.changeLanguage('uk');
});

afterEach(() => {
  cleanup();
  reset();
  vi.unstubAllGlobals();
  delete (window as { Telegram?: unknown }).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('PremiumBlock', () => {
  it('without the premium entitlement it shows a lock and never requests the content', async () => {
    const calls = stubApi([]);
    renderUi(<PremiumBlock />);

    expect(await screen.findByRole('heading', { name: 'Преміум-контент' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Відкрити доступ' })).toBeTruthy();
    expect(screen.queryByText('Ексклюзивний гайд')).toBeNull();
    expect(hit(calls, '/api/premium/content')).toEqual([]);
  });

  it('an entitlement for some other product keeps the block locked', async () => {
    const calls = stubApi([ENTITLEMENT('vip')]);
    renderUi(<PremiumBlock />);

    expect(await screen.findByRole('button', { name: 'Відкрити доступ' })).toBeTruthy();
    expect(hit(calls, '/api/premium/content')).toEqual([]);
  });

  it('the lock button opens the paywall layer', async () => {
    stubApi([]);
    renderUi(<PremiumBlock />);

    fireEvent.click(await screen.findByRole('button', { name: 'Відкрити доступ' }));

    expect(getStack()).toEqual([{ kind: 'paywall', props: {} }]);
  });

  it('with the premium entitlement it renders the items from /api/premium/content', async () => {
    const calls = stubApi([ENTITLEMENT('premium')]);
    renderUi(<PremiumBlock />);

    expect(await screen.findByText('Ексклюзивний гайд')).toBeTruthy();
    expect(screen.getByText('Закрита добірка')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Відкрити доступ' })).toBeNull();
    expect(hit(calls, '/api/premium/content')).toHaveLength(1);
  });
});

describe('PaywallSheet', () => {
  it('describes the subscription with its price', async () => {
    stubApi([]);
    renderUi(<PaywallSheet />);

    expect(await screen.findByRole('button', { name: 'Оформити' })).toBeTruthy();
    expect(await screen.findByText(/250 ⭐/)).toBeTruthy();
  });

  it('«Оформити» buys the premium product and closes the paywall once paid', async () => {
    const calls = stubApi([]);
    renderPaywall();

    await screen.findByText(/250 ⭐/);
    fireEvent.click(screen.getByRole('button', { name: 'Оформити' }));

    await waitFor(() =>
      expect(hit(calls, '/api/payments/invoice').map((c) => c.body)).toEqual([
        { productId: 'premium' },
      ]),
    );
    await waitFor(() => expect(getStack()).toEqual([]));
  });

  it('a payment that lands after the paywall was dismissed leaves the next layer open', async () => {
    const calls = stubApi([]);
    const other: Entry = { kind: 'adminUsers', props: {} };
    installFakeWebApp(window, {
      openInvoice: (_url: string, cb: (status: string) => void) => {
        pop();
        push(other);
        setTimeout(() => cb('paid'), 0);
      },
    });
    renderPaywall();
    await screen.findByText(/250 ⭐/);

    fireEvent.click(screen.getByRole('button', { name: 'Оформити' }));

    await waitFor(() => expect(hit(calls, '/api/payments/invoice')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(getStack()).toEqual([other]);
  });
});
