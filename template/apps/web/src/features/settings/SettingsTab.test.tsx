import { installFakeWebApp } from '@pctea/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@pctea/tma-web/react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../components/Toast';
import { i18n } from '../../i18n';
import { SettingsTab } from './SettingsTab';

const ME = {
  id: 7,
  firstName: 'Olena',
  username: 'olen',
  language: 'uk',
  theme: 'light',
  isAdmin: false,
  adminSource: null,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(patch: (body: Record<string, unknown>) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      const method = (init.method ?? 'GET').toUpperCase();
      if (path === '/api/me' && method === 'PATCH') return patch(JSON.parse(String(init.body)));
      if (path === '/api/me') return json(200, ME);
      return json(200, []);
    }),
  );
}

const failing = () =>
  json(500, { statusCode: 500, message: 'boom', error: 'Internal', code: 'HTTP_500' });

function renderTab() {
  return render(
    <TmaProvider client={createQueryClient()} i18n={i18n}>
      <SettingsTab />
      <ToastHost />
    </TmaProvider>,
  );
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

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

describe('SettingsTab: a failed PATCH /api/me', () => {
  it('rolls the language back and shows a toast', async () => {
    stubApi(failing);
    renderTab();
    await waitFor(() => expect(pressed('Українська')).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    expect(await screen.findByText('Щось пішло не так. Спробуйте ще раз.')).toBeTruthy();
    expect(i18n.language).toBe('uk');
    expect(pressed('Українська')).toBe('true');
  });

  it('rolls the theme back and shows a toast', async () => {
    stubApi(failing);
    renderTab();
    await waitFor(() => expect(pressed('Світла')).toBe('true'));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    fireEvent.click(screen.getByRole('button', { name: 'Темна' }));

    expect(await screen.findByText('Щось пішло не так. Спробуйте ще раз.')).toBeTruthy();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(pressed('Світла')).toBe('true');
  });

  it('keeps the new language once the PATCH succeeds', async () => {
    stubApi((body) => json(200, { ...ME, ...body }));
    renderTab();
    await waitFor(() => expect(pressed('Українська')).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    await waitFor(() => expect(i18n.language).toBe('en'));
    await waitFor(() => expect(pressed('English')).toBe('true'));
  });
});
