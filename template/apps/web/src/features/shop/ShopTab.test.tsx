import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@dmytro-rudenko/tma-web/react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../components/Toast';
import { i18n } from '../../i18n';
import { ShopTab } from './ShopTab';
import { SubscriptionSection } from './SubscriptionSection';

interface Call {
  method: string;
  path: string;
  body: unknown;
}

interface Entitlement {
  productId: string;
  source: 'subscription' | 'one_time' | 'grant';
  expiresAt: string | null;
  canceled: boolean;
}

const PREMIUM_UNTIL = '2027-01-15T00:00:00.000Z';

const PRODUCTS = [
  {
    id: 'premium',
    kind: 'subscription',
    repeatable: false,
    priceStars: 250,
    title: 'Преміум',
    description: 'Доступ на 30 днів',
  },
  {
    id: 'guide',
    kind: 'one_time',
    repeatable: false,
    priceStars: 100,
    title: 'Гайд',
    description: 'Назавжди',
  },
  {
    id: 'coffee',
    kind: 'one_time',
    repeatable: true,
    priceStars: 50,
    title: 'Кава',
    description: 'Підтримка',
  },
];

const PREMIUM_SUB: Entitlement = {
  productId: 'premium',
  source: 'subscription',
  expiresAt: PREMIUM_UNTIL,
  canceled: false,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Stub {
  calls: Call[];
  entitlements: Entitlement[];
  invoice: () => Response;
  onInvoice: () => void;
}

function stubApi(entitlements: Entitlement[] = []): Stub {
  const stub: Stub = {
    calls: [],
    entitlements,
    invoice: () => json(200, { invoiceLink: 'https://t.me/$inv1' }),
    onInvoice: () => undefined,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      stub.calls.push({
        method,
        path,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (path === '/api/products') return json(200, PRODUCTS);
      if (path === '/api/entitlements') return json(200, stub.entitlements);
      if (path === '/api/payments/invoice' && method === 'POST') {
        stub.onInvoice();
        return stub.invoice();
      }
      const sub = /^\/api\/subscriptions\/([^/]+)\/(cancel|resume)$/.exec(path);
      if (sub && method === 'POST') {
        const e = stub.entitlements.find((x) => x.productId === sub[1]);
        if (!e)
          return json(404, { statusCode: 404, message: 'x', error: 'x', code: 'NO_SUBSCRIPTION' });
        e.canceled = sub[2] === 'cancel';
        return json(200, e);
      }
      return json(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
        code: 'HTTP_404',
      });
    }),
  );
  return stub;
}

const posts = (stub: Stub) => stub.calls.filter((c) => c.method === 'POST');

function renderUi(ui: React.ReactNode) {
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      {ui}
      <ToastHost />
    </TmaProvider>,
  );
}

async function card(title: string): Promise<HTMLElement> {
  const el = (await screen.findByText(title)).closest('li');
  expect(el, `<li> around "${title}"`).not.toBeNull();
  return el as HTMLElement;
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

let invoiceCallbacks: Array<(status: string) => void> = [];

function installTelegram(autoStatus: string | null = 'paid') {
  invoiceCallbacks = [];
  installFakeWebApp(window, {
    openInvoice: vi.fn((_url: string, cb: (s: string) => void) => {
      if (autoStatus) cb(autoStatus);
      else invoiceCallbacks.push(cb);
    }),
  });
}

beforeEach(async () => {
  localStorage.clear();
  installTelegram();
  await i18n.changeLanguage('uk');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { Telegram?: unknown }).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('ShopTab: catalogue', () => {
  it('lists every product with its price and the right call to action per kind', async () => {
    stubApi();
    renderUi(<ShopTab />);

    const premium = await card('Преміум');
    expect(premium.textContent).toContain('Доступ на 30 днів');
    expect(premium.textContent).toContain('250 ⭐');
    expect(within(premium).getByRole('button', { name: 'Оформити' })).toBeTruthy();

    const coffee = await card('Кава');
    expect(coffee.textContent).toContain('50 ⭐');
    expect(within(coffee).getByRole('button', { name: 'Купити' })).toBeTruthy();
  });

  it('shows «Активно до …» instead of the button for an active subscription', async () => {
    stubApi([PREMIUM_SUB]);
    renderUi(<ShopTab />);

    const premium = await card('Преміум');
    await waitFor(() => expect(premium.textContent).toContain(`Активно до ${day(PREMIUM_UNTIL)}`));
    expect(within(premium).queryByRole('button')).toBeNull();
  });

  it('shows «Активно» for an owned one-time product but keeps a repeatable one purchasable', async () => {
    stubApi([
      { productId: 'guide', source: 'one_time', expiresAt: null, canceled: false },
      { productId: 'coffee', source: 'one_time', expiresAt: null, canceled: false },
    ]);
    renderUi(<ShopTab />);

    const guide = await card('Гайд');
    await waitFor(() => expect(guide.textContent).toContain('Активно'));
    expect(within(guide).queryByRole('button')).toBeNull();

    const coffee = await card('Кава');
    expect(within(coffee).getByRole('button', { name: 'Купити' })).toBeTruthy();
    expect(coffee.textContent).not.toContain('Активно');
  });
});

describe('ShopTab: purchase states', () => {
  it('«Купити» creates an invoice for that product and opens it in Telegram', async () => {
    const stub = stubApi();
    renderUi(<ShopTab />);

    fireEvent.click(within(await card('Кава')).getByRole('button', { name: 'Купити' }));

    await waitFor(() =>
      expect(posts(stub).map((c) => [c.path, c.body])).toEqual([
        ['/api/payments/invoice', { productId: 'coffee' }],
      ]),
    );
    const openInvoice = (window as { Telegram?: { WebApp: { openInvoice: unknown } } }).Telegram!
      .WebApp.openInvoice as ReturnType<typeof vi.fn>;
    await waitFor(() =>
      expect(openInvoice).toHaveBeenCalledWith('https://t.me/$inv1', expect.anything()),
    );
  });

  it('while paying every buy button is blocked; it frees up once the invoice closes', async () => {
    stubApi();
    installTelegram(null);
    renderUi(<ShopTab />);
    const coffee = await card('Кава');
    const premium = await card('Преміум');

    fireEvent.click(within(coffee).getByRole('button', { name: 'Купити' }));

    await waitFor(() => expect(invoiceCallbacks).toHaveLength(1));
    expect(within(coffee).getByRole('button', { name: 'Купити' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(within(premium).getByRole('button', { name: 'Оформити' }).hasAttribute('disabled')).toBe(
      true,
    );

    invoiceCallbacks[0]!('cancelled');

    await waitFor(() =>
      expect(within(coffee).getByRole('button', { name: 'Купити' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
  });

  it('a paid subscription flips its card to «Активно до …»', async () => {
    const stub = stubApi();
    stub.onInvoice = () => {
      stub.entitlements = [PREMIUM_SUB];
    };
    renderUi(<ShopTab />);

    fireEvent.click(within(await card('Преміум')).getByRole('button', { name: 'Оформити' }));

    await waitFor(async () =>
      expect((await card('Преміум')).textContent).toContain(`Активно до ${day(PREMIUM_UNTIL)}`),
    );
  });

  it('a failed invoice shows a toast and unblocks the button', async () => {
    stubApi();
    installTelegram('failed');
    renderUi(<ShopTab />);
    const coffee = await card('Кава');

    fireEvent.click(within(coffee).getByRole('button', { name: 'Купити' }));

    expect(await screen.findByText('Оплата не пройшла. Спробуйте ще раз.')).toBeTruthy();
    expect(within(coffee).getByRole('button', { name: 'Купити' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('an API error from the invoice request is shown as its mapped message', async () => {
    const stub = stubApi();
    stub.invoice = () =>
      json(409, { statusCode: 409, message: 'x', error: 'Conflict', code: 'ALREADY_SUBSCRIBED' });
    renderUi(<ShopTab />);

    fireEvent.click(within(await card('Преміум')).getByRole('button', { name: 'Оформити' }));

    expect(await screen.findByText('Підписку вже оформлено.')).toBeTruthy();
  });
});

describe('SubscriptionSection', () => {
  it('renders nothing without a subscription entitlement', async () => {
    const stub = stubApi([
      { productId: 'premium', source: 'grant', expiresAt: PREMIUM_UNTIL, canceled: false },
    ]);
    const { container } = renderUi(<SubscriptionSection />);

    await waitFor(() => expect(stub.calls.some((c) => c.path === '/api/entitlements')).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Підписка')).toBeNull();
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows the next charge date and cancels, then offers «Відновити» and resumes', async () => {
    const stub = stubApi([{ ...PREMIUM_SUB }]);
    renderUi(<SubscriptionSection />);

    expect(await screen.findByText('Підписка')).toBeTruthy();
    expect(await screen.findByText(`Наступне списання: ${day(PREMIUM_UNTIL)}`)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    await waitFor(() =>
      expect(posts(stub).map((c) => c.path)).toEqual(['/api/subscriptions/premium/cancel']),
    );
    expect(
      await screen.findByText(`Підписку скасовано. Доступ до ${day(PREMIUM_UNTIL)}`),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Відновити' }));
    await waitFor(() =>
      expect(posts(stub).map((c) => c.path)).toEqual([
        '/api/subscriptions/premium/cancel',
        '/api/subscriptions/premium/resume',
      ]),
    );
    expect(await screen.findByText(`Наступне списання: ${day(PREMIUM_UNTIL)}`)).toBeTruthy();
  });
});
