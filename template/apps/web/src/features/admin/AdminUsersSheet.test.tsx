import { installFakeWebApp } from 'tma-starter/testing/dom';
import { TmaProvider, createQueryClient } from 'tma-starter/web/react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { AdminUsersSheet } from './AdminUsersSheet';

const ME = {
  id: 1,
  firstName: 'Admin',
  username: 'admin',
  language: 'uk',
  theme: 'system',
  isAdmin: true,
  adminSource: 'env',
};

const USERS = [
  {
    id: 42,
    firstName: 'Olena',
    username: 'olen',
    isAdmin: true,
    blockedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  },
  {
    id: 43,
    firstName: 'Taras',
    username: null,
    isAdmin: false,
    blockedAt: '2026-10-05T00:00:00.000Z',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(): string[] {
  const searches: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      if (url.pathname === '/api/me') return json(200, ME);
      if (url.pathname === '/api/admin/users') {
        searches.push(url.searchParams.get('q') ?? '');
        return json(200, { items: USERS, nextCursor: null });
      }
      return json(404, {
        statusCode: 404,
        message: 'Not Found',
        error: 'Not Found',
        code: 'HTTP_404',
      });
    }),
  );
  return searches;
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

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

describe('AdminUsersSheet', () => {
  it('lists users with the admin and blocked chips and an @username line', async () => {
    stubApi();
    render(
      <TmaProvider client={createQueryClient()} i18n={i18n}>
        <AdminUsersSheet />
      </TmaProvider>,
    );
    const olena = (await screen.findByText('Olena')).closest('button')!;
    expect(olena.textContent).toContain('admin');
    expect(olena.textContent).toContain('@olen');
    const taras = screen.getByText('Taras').closest('button')!;
    expect(taras.textContent).toContain('blocked');
    expect(taras.textContent).not.toContain('admin');
  });

  it('searches 300 ms after the last keystroke, once, with the trimmed text', async () => {
    const searches = stubApi();
    render(
      <TmaProvider client={createQueryClient()} i18n={i18n}>
        <AdminUsersSheet />
      </TmaProvider>,
    );
    await screen.findByText('Olena');
    expect(searches).toEqual(['']);

    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'ol' } });
    await tick(200);
    fireEvent.change(input, { target: { value: ' olen ' } });
    await tick(200);
    expect(searches).toEqual(['']);
    await tick(110);
    expect(searches).toEqual(['', 'olen']);
  });
});
