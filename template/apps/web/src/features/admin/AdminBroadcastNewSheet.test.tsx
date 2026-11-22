import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@dmytro-rudenko/tma-web/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
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

function stubApi() {
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
      if (path === '/api/admin/broadcasts' && method === 'POST')
        return json(201, { id: 'b1', total: 12 });
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

function renderSheet() {
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      <AdminBroadcastNewSheet />
    </TmaProvider>,
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  installFakeWebApp(window);
  await i18n.changeLanguage('uk');
});

afterEach(() => {
  cleanup();
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
