import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { i18n } from './i18n';
import { reset } from './state/stack';

const USER = {
  id: 7,
  firstName: 'Olena',
  username: 'olen',
  language: 'uk',
  theme: 'system',
  isAdmin: false,
  adminSource: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(me: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      if (path === '/api/me') return me();
      return json(200, []);
    }),
  );
}

beforeEach(async () => {
  localStorage.clear();
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

describe('App', () => {
  it('greets the user by name on the Home tab', async () => {
    stubApi(() => json(200, USER));
    render(<App />);
    expect(await screen.findByText('Привіт, Olena!')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toContain(
      'true',
    );
  });

  it('shows the blocked screen instead of the app when /api/me answers USER_BLOCKED', async () => {
    stubApi(() =>
      json(403, { statusCode: 403, message: 'blocked', error: 'Forbidden', code: 'USER_BLOCKED' }),
    );
    render(<App />);
    expect(await screen.findByText('Доступ закрито')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
