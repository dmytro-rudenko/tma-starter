import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@dmytro-rudenko/tma-web/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { AdminBroadcastSheet } from './AdminBroadcastSheet';

const ME = {
  id: 1,
  firstName: 'Admin',
  username: 'admin',
  language: 'uk',
  theme: 'system',
  isAdmin: true,
  adminSource: 'env',
};

const broadcast = (status: string, sent: number) => ({
  id: 'b1',
  createdBy: 1,
  text: 'Hello everyone',
  button: null,
  audience: {},
  status,
  total: 10,
  sent,
  failed: 0,
  createdAt: '2026-11-01T10:00:00.000Z',
  startedAt: '2026-11-01T10:00:01.000Z',
  finishedAt: status === 'done' ? '2026-11-01T10:05:00.000Z' : null,
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(responses: ReturnType<typeof broadcast>[]) {
  const calls: string[] = [];
  let polled = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${path}`);
      if (path === '/api/me') return json(200, ME);
      if (path === '/api/admin/broadcasts/b1' && method === 'GET') {
        return json(200, responses[Math.min(polled++, responses.length - 1)]);
      }
      if (path === '/api/admin/broadcasts/b1/cancel' && method === 'POST') {
        return json(200, broadcast('canceled', 4));
      }
      return json(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
        code: 'HTTP_404',
      });
    }),
  );
  return () => calls.filter((c) => c === 'GET /api/admin/broadcasts/b1').length;
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function renderSheet() {
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      <AdminBroadcastSheet id="b1" />
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

describe('AdminBroadcastSheet: progress polling', () => {
  it('re-fetches every 3 s while the broadcast runs and stops once it is done', async () => {
    const fetched = stubApi([
      broadcast('queued', 0),
      broadcast('running', 4),
      broadcast('running', 8),
      broadcast('done', 10),
    ]);
    renderSheet();
    expect(await screen.findByText('Надіслано 0 з 10')).toBeTruthy();
    expect(fetched()).toBe(1);

    await tick(2500);
    expect(fetched()).toBe(1);
    await tick(600);
    expect(fetched()).toBe(2);
    expect(await screen.findByText('Надіслано 4 з 10')).toBeTruthy();

    await tick(3000);
    expect(await screen.findByText('Надіслано 8 з 10')).toBeTruthy();
    await tick(3000);
    expect(await screen.findByText('Надіслано 10 з 10')).toBeTruthy();
    expect(fetched()).toBe(4);

    await tick(10_000);
    expect(fetched()).toBe(4);
  });

  it('does not poll a finished broadcast', async () => {
    const fetched = stubApi([broadcast('done', 10)]);
    renderSheet();
    await screen.findByText('Надіслано 10 з 10');
    await tick(10_000);
    expect(fetched()).toBe(1);
  });

  it('«Скасувати розсилку» asks first, then POSTs the cancel and shows the canceled status', async () => {
    stubApi([broadcast('running', 4)]);
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Скасувати розсилку' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Скасувати розсилку',
      )!,
    );
    expect(await screen.findByText('скасовано')).toBeTruthy();
  });
});
