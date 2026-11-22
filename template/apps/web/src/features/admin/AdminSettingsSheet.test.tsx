import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { TmaProvider, createQueryClient } from '@dmytro-rudenko/tma-web/react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorText } from '../../api/errorText';
import { i18n } from '../../i18n';
import { AdminSettingsSheet } from './AdminSettingsSheet';

interface Setting {
  key: string;
  value: unknown;
  default: unknown;
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

const ME = {
  id: 42,
  firstName: 'Olena',
  username: 'olen',
  language: 'uk',
  theme: 'system',
  isAdmin: true,
  adminSource: 'env',
};

const SETTINGS: Setting[] = [
  { key: 'demo.enabled', value: true, default: false },
  { key: 'demo.limit', value: 5, default: 10 },
  { key: 'demo.greeting', value: 'Привіт', default: 'Hello' },
  { key: 'payments.test_users', value: [111, 222], default: [] },
  { key: 'demo.tags', value: ['a', 'b'], default: ['a'] },
  { key: 'demo.limits', value: { daily: 3 }, default: { daily: 1 } },
];

const VALIDATION_BODY = {
  statusCode: 400,
  message: 'payments.test_users must be an array of user ids',
  error: 'Bad Request',
  code: 'VALIDATION',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(patch: (body: { key: string; value: unknown }) => Response): Call[] {
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
      if (path === '/api/admin/settings' && method === 'GET') return json(200, SETTINGS);
      if (path === '/api/admin/settings' && method === 'PATCH') return patch(body);
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

const updated = (body: { key: string; value: unknown }) =>
  json(
    200,
    SETTINGS.map((s) => (s.key === body.key ? { ...s, value: body.value } : s)),
  );

function renderSheet() {
  const qc = createQueryClient();
  return render(
    <TmaProvider client={qc} i18n={i18n}>
      <AdminSettingsSheet />
    </TmaProvider>,
  );
}

const group = (key: string) => screen.findByRole('group', { name: key });

const patches = (calls: Call[]) =>
  calls.filter((c) => c.method === 'PATCH').map(({ path, body }) => ({ path, body }));

async function save(key: string) {
  fireEvent.click(within(await group(key)).getByRole('button', { name: 'Зберегти' }));
}

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

describe('AdminSettingsSheet: the editor is picked by the type of default', () => {
  it('boolean default → a switch showing the current value', async () => {
    stubApi(updated);
    renderSheet();
    const g = await group('demo.enabled');
    expect(within(g).getByRole('switch', { checked: true })).toBeTruthy();
    expect(within(g).queryByRole('textbox')).toBeNull();
    expect(within(g).queryByRole('spinbutton')).toBeNull();
  });

  it('number default → a number input', async () => {
    stubApi(updated);
    renderSheet();
    const g = await group('demo.limit');
    const input = within(g).getByRole('spinbutton') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('number');
    expect(input.value).toBe('5');
    expect(within(g).queryByRole('switch')).toBeNull();
  });

  it('string default → a single-line text input', async () => {
    stubApi(updated);
    renderSheet();
    const g = await group('demo.greeting');
    const input = within(g).getByRole('textbox') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('Привіт');
  });

  it('number[] default (payments.test_users, default []) → an "id через кому" field', async () => {
    stubApi(updated);
    renderSheet();
    const g = await group('payments.test_users');
    const input = within(g).getByRole('textbox') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.placeholder).toBe('id через кому');
    expect(input.value).toBe('111, 222');
  });

  it.each([
    ['demo.limits', { daily: 3 }],
    ['demo.tags', ['a', 'b']],
  ] as const)('%s (object or non-number array) → a JSON textarea', async (key, value) => {
    stubApi(updated);
    renderSheet();
    const g = await group(key);
    const area = within(g).getByRole('textbox') as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe(JSON.stringify(value, null, 2));
  });
});

describe('AdminSettingsSheet: saving', () => {
  it('boolean: toggling and saving PATCHes the new value', async () => {
    const calls = stubApi(updated);
    renderSheet();
    fireEvent.click(within(await group('demo.enabled')).getByRole('switch'));
    await save('demo.enabled');
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        { path: '/api/admin/settings', body: { key: 'demo.enabled', value: false } },
      ]),
    );
  });

  it('number: saving PATCHes a number, not a string', async () => {
    const calls = stubApi(updated);
    renderSheet();
    fireEvent.change(within(await group('demo.limit')).getByRole('spinbutton'), {
      target: { value: '7' },
    });
    await save('demo.limit');
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        { path: '/api/admin/settings', body: { key: 'demo.limit', value: 7 } },
      ]),
    );
  });

  it('string: saving PATCHes the text', async () => {
    const calls = stubApi(updated);
    renderSheet();
    fireEvent.change(within(await group('demo.greeting')).getByRole('textbox'), {
      target: { value: 'Вітаю' },
    });
    await save('demo.greeting');
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        { path: '/api/admin/settings', body: { key: 'demo.greeting', value: 'Вітаю' } },
      ]),
    );
  });

  it('number[]: comma-separated ids are PATCHed as an array of numbers', async () => {
    const calls = stubApi(updated);
    renderSheet();
    fireEvent.change(within(await group('payments.test_users')).getByRole('textbox'), {
      target: { value: '111, 222,333' },
    });
    await save('payments.test_users');
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        {
          path: '/api/admin/settings',
          body: { key: 'payments.test_users', value: [111, 222, 333] },
        },
      ]),
    );
  });

  it('JSON: the parsed textarea value is PATCHed', async () => {
    const calls = stubApi(updated);
    renderSheet();
    fireEvent.change(within(await group('demo.limits')).getByRole('textbox'), {
      target: { value: '{"daily": 9}' },
    });
    await save('demo.limits');
    await waitFor(() =>
      expect(patches(calls)).toEqual([
        { path: '/api/admin/settings', body: { key: 'demo.limits', value: { daily: 9 } } },
      ]),
    );
  });

  it('VALIDATION from the server is shown under that field only', async () => {
    const calls = stubApi(() => json(400, VALIDATION_BODY));
    renderSheet();
    fireEvent.change(within(await group('payments.test_users')).getByRole('textbox'), {
      target: { value: '-5' },
    });
    await save('payments.test_users');
    const g = await group('payments.test_users');
    expect(await within(g).findByText(errorText.uk.VALIDATION)).toBeTruthy();
    expect(screen.getAllByText(errorText.uk.VALIDATION)).toHaveLength(1);
    expect(screen.queryByText(VALIDATION_BODY.message)).toBeNull();
    expect(patches(calls)).toEqual([
      { path: '/api/admin/settings', body: { key: 'payments.test_users', value: [-5] } },
    ]);
  });
});
