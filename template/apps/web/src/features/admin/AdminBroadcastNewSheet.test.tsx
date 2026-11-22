import { installFakeWebApp } from '@pctea/tma/testing/dom';
import { TmaProvider, createQueryClient } from '@pctea/tma/web/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { getStack, LayerContext, pop, push, reset, type Entry } from '../../state/stack';
import { AdminBroadcastNewSheet } from './AdminBroadcastNewSheet';

const ME = {
  id: 1,
  firstName: 'Admin',
  username: 'admin',
  language: 'uk',
  theme: 'system',
  isAdmin: true,
  adminSource: 'env',
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(create: () => Promise<Response> = async () => json(201, { id: 'b1', total: 12 })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (path === '/api/me') return json(200, ME);
      if (path === '/api/products')
        return json(200, [
          {
            id: 'p1',
            kind: 'one_time',
            repeatable: false,
            priceStars: 1,
            title: 'P1',
            description: '',
          },
        ]);
      if (path === '/api/admin/broadcasts/audience-filters')
        return json(200, [{ key: 'entitlement', label: 'Has a product' }]);
      if (path === '/api/admin/broadcasts/estimate') {
        const languages = (body as { audience: { languages?: string[] } }).audience.languages;
        return json(200, { total: languages ? 7 : 12 });
      }
      if (path === '/api/admin/broadcasts' && method === 'POST') return create();
      return json(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
        code: 'HTTP_404',
      });
    }),
  );
  const estimates = () =>
    calls
      .filter((c) => c.path === '/api/admin/broadcasts/estimate')
      .map((c) => (c.body as { audience: unknown }).audience);
  return { calls, estimates };
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const SELF: Entry = { kind: 'adminBroadcastNew', props: {} };

function renderSheet() {
  push(SELF);
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      <LayerContext.Provider value={{ index: 0, isTop: true, entry: SELF }}>
        <AdminBroadcastNewSheet />
      </LayerContext.Provider>
    </TmaProvider>,
  );
}

const confirmButton = (dialog: HTMLElement) =>
  Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Надіслати')!;

async function askToSend() {
  await screen.findByText('Отримувачів: 12');
  fireEvent.change(screen.getByRole('textbox', { name: 'Текст (HTML)' }), {
    target: { value: '<b>Hi</b>' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
  return screen.findByRole('alertdialog');
}

const posted = (calls: Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/admin/broadcasts');

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  installFakeWebApp(window);
  await i18n.changeLanguage('uk');
});

afterEach(() => {
  cleanup();
  reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as { Telegram?: unknown }).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('AdminBroadcastNewSheet: recipients estimate', () => {
  it('re-estimates 500 ms after the last audience change, once', async () => {
    const { estimates } = stubApi();
    renderSheet();
    expect(await screen.findByText('Отримувачів: 12')).toBeTruthy();
    expect(estimates()).toEqual([{}]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
    await tick(300);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Має активний продукт' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Продукт' }), {
      target: { value: 'p1' },
    });
    await tick(400);
    expect(estimates()).toEqual([{}]);
    expect(screen.getByText('Отримувачів: …')).toBeTruthy();

    await tick(150);
    expect(estimates()).toEqual([{}, { languages: ['uk'], filters: { entitlement: 'p1' } }]);
  });

  it('shows the new count once the estimate settles', async () => {
    stubApi();
    renderSheet();
    await screen.findByText('Отримувачів: 12');
    fireEvent.click(screen.getByRole('checkbox', { name: 'English' }));
    await tick(510);
    expect(await screen.findByText('Отримувачів: 7')).toBeTruthy();
  });

  it('sends only after a confirm that names the recipient count, with the settled audience', async () => {
    const { calls } = stubApi();
    renderSheet();
    await screen.findByText('Отримувачів: 12');
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст (HTML)' }), {
      target: { value: '<b>Hi</b>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Отримувачів: 12');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/admin/broadcasts')).toBe(
      false,
    );
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Надіслати')!,
    );
    await vi.waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/api/admin/broadcasts')?.body,
      ).toEqual({
        text: '<b>Hi</b>',
        audience: {},
      }),
    );
  });
});

describe('AdminBroadcastNewSheet: confirm', () => {
  it('locks the form while the send confirm is open', async () => {
    const { calls } = stubApi();
    renderSheet();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Має активний продукт' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Продукт' }), {
      target: { value: 'p1' },
    });
    await tick(510);
    await screen.findByText('Отримувачів: 12');
    const controls = () => [
      screen.getByRole('textbox', { name: 'Текст (HTML)' }),
      ...screen.getAllByRole('checkbox'),
      screen.getByRole('combobox', { name: 'Продукт' }),
    ];
    expect(controls().filter((c) => c.matches(':disabled'))).toEqual([]);

    const dialog = await askToSend();
    expect(controls().filter((c) => !c.matches(':disabled'))).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Скасувати' }));
    expect(controls().filter((c) => c.matches(':disabled'))).toEqual([]);

    fireEvent.click(confirmButton(await askToSend()));
    await vi.waitFor(() =>
      expect(posted(calls).map((c) => c.body)).toEqual([
        { text: '<b>Hi</b>', audience: { filters: { entitlement: 'p1' } } },
      ]),
    );
  });

  it('opens the created broadcast in place of this sheet', async () => {
    stubApi();
    renderSheet();
    fireEvent.click(confirmButton(await askToSend()));
    await vi.waitFor(() =>
      expect(getStack()).toEqual([{ kind: 'adminBroadcast', props: { id: 'b1' } }]),
    );
  });

  it('leaves a layer opened while the create was pending in place', async () => {
    let answer!: (r: Response) => void;
    const { calls } = stubApi(() => new Promise<Response>((resolve) => (answer = resolve)));
    renderSheet();
    fireEvent.click(confirmButton(await askToSend()));
    await vi.waitFor(() => expect(posted(calls)).toHaveLength(1));

    const other: Entry = { kind: 'adminUsers', props: {} };
    pop();
    push(other);
    answer(json(201, { id: 'b1', total: 12 }));
    await tick(50);

    expect(getStack()).toEqual([other]);
  });
});
