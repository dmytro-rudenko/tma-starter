import type { QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler[]>();
  const managerHandlers = new Map<string, Handler[]>();
  const add = (m: Map<string, Handler[]>, e: string, h: Handler) =>
    m.set(e, [...(m.get(e) ?? []), h]);
  const remove = (m: Map<string, Handler[]>, e: string, h?: Handler) =>
    h ? m.set(e, (m.get(e) ?? []).filter((x) => x !== h)) : m.delete(e);
  const manager = {
    on(e: string, h: Handler) {
      add(managerHandlers, e, h);
      return manager;
    },
    off(e: string, h?: Handler) {
      remove(managerHandlers, e, h);
      return manager;
    },
  };
  const socket = {
    connected: false,
    io: manager,
    on(e: string, h: Handler) {
      add(handlers, e, h);
      return socket;
    },
    off(e: string, h?: Handler) {
      remove(handlers, e, h);
      return socket;
    },
    emit: () => socket,
    connect: () => socket,
    disconnect: () => socket,
    close: () => socket,
  };
  return {
    socket,
    fire(e: string, ...args: unknown[]) {
      for (const h of handlers.get(e) ?? []) h(...args);
    },
    fireManager(e: string, ...args: unknown[]) {
      for (const h of managerHandlers.get(e) ?? []) h(...args);
    },
    reset() {
      handlers.clear();
      managerHandlers.clear();
    },
  };
});

const ioMock = vi.hoisted(() => vi.fn());

vi.mock('socket.io-client', () => ({ io: ioMock, default: ioMock }));

import { ApiError, createApiClient, createI18n, tg } from '@dmytro-rudenko/tma-web';
import {
  TmaProvider,
  createQueryClient,
  tmaKeys,
  useMe,
  usePurchase,
  useRealtimeEvent,
} from '@dmytro-rudenko/tma-web/react';
import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';

const INIT_DATA = 'query_id=AAH1&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Olia%22%7D&auth_date=1700000000&hash=abc';

type Route = (url: string, init: RequestInit) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(route: Route) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return route(url, init) ?? json(404, { statusCode: 404, message: 'nope', error: 'Not Found', code: 'NOT_FOUND' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name);
}

function makeI18n() {
  return createI18n({
    resources: { en: { translation: { hi: 'Hi' } }, uk: { translation: { hi: 'Привіт' } } },
    supported: ['uk', 'en'],
    fallback: 'en',
  });
}

function wrapperFor(qc: QueryClient, i18n: ReturnType<typeof makeI18n>) {
  return ({ children }: { children: ReactNode }) => (
    <TmaProvider client={qc} i18n={i18n.i18n}>
      {children}
    </TmaProvider>
  );
}

beforeEach(() => {
  sock.reset();
  ioMock.mockReset();
  ioMock.mockImplementation(() => sock.socket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as any).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('tma-web acceptance', () => {
  it("tg works without WebApp: initDataRaw '' , openInvoice 'failed', no throw", async () => {
    delete (window as any).Telegram;
    expect(tg.initDataRaw()).toBe('');
    expect(() => tg.init()).not.toThrow();
    expect(() => tg.haptic.impact('light')).not.toThrow();
    expect(() => tg.haptic.notify('success')).not.toThrow();
    expect(() => tg.openTelegramLink('https://t.me/demo_app_bot')).not.toThrow();
    expect(() => tg.syncSafeArea()()).not.toThrow();
    expect(() => tg.onThemeChanged(() => undefined)()).not.toThrow();
    await expect(tg.openInvoice('https://t.me/$invoice')).resolves.toBe('failed');
  });

  it('Android adds 24px min bottom inset', () => {
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    const root = document.documentElement.style;

    installFakeWebApp(window, {
      platform: 'android',
      isFullscreen: true,
      safeAreaInset: { ...zero, top: 10 },
      contentSafeAreaInset: zero,
    });
    tg.syncSafeArea()();
    expect(root.getPropertyValue('--tg-safe-area-inset-bottom')).toBe('24px');

    installFakeWebApp(window, {
      platform: 'android',
      isFullscreen: true,
      safeAreaInset: { ...zero, bottom: 30 },
      contentSafeAreaInset: zero,
    });
    tg.syncSafeArea()();
    expect(root.getPropertyValue('--tg-safe-area-inset-bottom')).toBe('30px');

    installFakeWebApp(window, {
      platform: 'ios',
      isFullscreen: true,
      safeAreaInset: zero,
      contentSafeAreaInset: zero,
    });
    tg.syncSafeArea()();
    expect(root.getPropertyValue('--tg-safe-area-inset-bottom')).toBe('0px');
  });

  it("openInvoice returns 'failed' when SDK throws", async () => {
    installFakeWebApp(window, {
      openInvoice: () => {
        throw new Error('WebAppMethodUnsupported');
      },
    });
    await expect(tg.openInvoice('https://t.me/$invoice')).resolves.toBe('failed');

    installFakeWebApp(window, {
      openInvoice: (_url: string, cb: (s: string) => void) => cb('paid'),
    });
    await expect(tg.openInvoice('https://t.me/$invoice')).resolves.toBe('paid');
  });

  it('api client sends Authorization tma and maps ApiError', async () => {
    installFakeWebApp(window, { initData: INIT_DATA });
    const fetchMock = stubFetch((url, init) => {
      if (url === 'https://api.test/api/me' && (init.method ?? 'GET') === 'GET') {
        return json(200, { id: 42 });
      }
      if (url === 'https://api.test/api/me' && init.method === 'PATCH') {
        return json(403, {
          statusCode: 403,
          message: 'User is blocked',
          error: 'Forbidden',
          code: 'USER_BLOCKED',
        });
      }
      return undefined;
    });
    const client = createApiClient({ baseUrl: 'https://api.test' });

    await expect(client.request('/api/me')).resolves.toEqual({ id: 42 });
    expect(headerOf(fetchMock.mock.calls[0][1], 'Authorization')).toBe(`tma ${INIT_DATA}`);

    const failure = await client
      .request('/api/me', { method: 'PATCH', json: { theme: 'dark' } })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const patchInit = fetchMock.mock.calls[1][1]!;
    expect(JSON.parse(String(patchInit.body))).toEqual({ theme: 'dark' });
    expect(headerOf(patchInit, 'Content-Type')).toMatch(/application\/json/);
    expect(headerOf(patchInit, 'Authorization')).toBe(`tma ${INIT_DATA}`);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 403, code: 'USER_BLOCKED', message: 'User is blocked' });
  });

  it('langFromCode', () => {
    const { langFromCode } = makeI18n();
    expect(langFromCode('uk')).toBe('uk');
    expect(langFromCode('en')).toBe('en');
    expect(langFromCode('ru')).toBe('en');
    expect(langFromCode('de')).toBe('en');
    expect(langFromCode('')).toBe('en');
    expect(langFromCode(undefined)).toBe('en');
  });

  it('usePurchase: settled, paid, cancelled, failed, pending→payment.settled', async () => {
    const notify = vi.fn();
    const scenario = async (
      invoiceBody: unknown,
      sdkStatus: 'paid' | 'cancelled' | 'failed' | 'pending' | null,
    ) => {
      cleanup();
      sock.reset();
      notify.mockClear();
      const openInvoice = vi.fn((_url: string, cb: (s: string) => void) => {
        if (sdkStatus) cb(sdkStatus);
      });
      installFakeWebApp(window, {
        initData: INIT_DATA,
        openInvoice,
        HapticFeedback: { notificationOccurred: notify, impactOccurred: vi.fn(), selectionChanged: vi.fn() },
      });
      stubFetch((url, init) => {
        if (url.endsWith('/api/payments/invoice') && init.method === 'POST') {
          expect(JSON.parse(String(init.body))).toEqual({ productId: 'premium' });
          return json(200, invoiceBody);
        }
        if (url.endsWith('/api/me')) {
          return json(200, { id: 42, firstName: 'Olia', username: null, language: 'en', theme: 'system', isAdmin: false, adminSource: null });
        }
        if (url.endsWith('/api/entitlements') || url.endsWith('/api/products')) return json(200, []);
        return undefined;
      });
      const qc = createQueryClient();
      const invalidate = vi.spyOn(qc, 'invalidateQueries');
      const hook = renderHook(() => usePurchase(), { wrapper: wrapperFor(qc, makeI18n()) });
      expect(hook.result.current.status).toBe('idle');
      act(() => {
        void hook.result.current.purchase({ productId: 'premium' });
      });
      return { hook, openInvoice, invalidate };
    };
    const invalidated = (spy: { mock: { calls: unknown[][] } }, key: unknown) =>
      spy.mock.calls.some(([arg]) => JSON.stringify((arg as any)?.queryKey) === JSON.stringify(key));

    {
      const { hook, openInvoice } = await scenario({ settled: true }, null);
      await waitFor(() => expect(hook.result.current.status).toBe('paid'));
      expect(openInvoice).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalled();
    }

    {
      const { hook, openInvoice, invalidate } = await scenario({ invoiceLink: 'https://t.me/$inv1' }, 'paid');
      await waitFor(() => expect(hook.result.current.status).toBe('paid'));
      expect(openInvoice).toHaveBeenCalledWith('https://t.me/$inv1', expect.any(Function));
      expect(invalidated(invalidate, tmaKeys.me)).toBe(true);
      expect(invalidated(invalidate, tmaKeys.entitlements)).toBe(true);
      expect(invalidated(invalidate, tmaKeys.products)).toBe(true);
      expect(notify).toHaveBeenCalled();
    }

    for (const outcome of ['cancelled', 'failed'] as const) {
      const { hook, invalidate } = await scenario({ invoiceLink: 'https://t.me/$inv2' }, outcome);
      await waitFor(() => expect(hook.result.current.status).toBe(outcome));
      expect(invalidated(invalidate, tmaKeys.entitlements)).toBe(false);
      expect(notify).toHaveBeenCalled();
    }

    {
      const { hook, openInvoice, invalidate } = await scenario({ invoiceLink: 'https://t.me/$inv3' }, 'pending');
      await waitFor(() => expect(openInvoice).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 50));
      expect(hook.result.current.status).toBe('paying');
      expect(invalidated(invalidate, tmaKeys.entitlements)).toBe(false);
      act(() => {
        sock.fire('connect');
        sock.fire('payment.settled', { productId: 'premium', paymentId: 'p-1' });
      });
      await waitFor(() => expect(hook.result.current.status).toBe('paid'));
      expect(invalidated(invalidate, tmaKeys.entitlements)).toBe(true);
      expect(notify).toHaveBeenCalled();
    }
  });

  it('useMe applies theme and language', async () => {
    installFakeWebApp(window, { initData: INIT_DATA });
    stubFetch((url) => {
      if (url.endsWith('/api/me')) {
        return json(200, {
          id: 42,
          firstName: 'Olia',
          username: null,
          language: 'uk',
          theme: 'dark',
          isAdmin: false,
          adminSource: null,
        });
      }
      return undefined;
    });
    const i18n = makeI18n();
    const qc = createQueryClient();
    renderHook(() => useMe(), { wrapper: wrapperFor(qc, i18n) });

    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
    await waitFor(() => expect(i18n.i18n.language).toBe('uk'));
  });

  it('useRealtimeEvent invalidates me/entitlements on reconnect', async () => {
    installFakeWebApp(window, { initData: INIT_DATA });
    stubFetch(() => json(200, {}));
    const qc = createQueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const handler = vi.fn();
    renderHook(() => useRealtimeEvent('payment.settled', handler), {
      wrapper: wrapperFor(qc, makeI18n()),
    });

    await waitFor(() => expect(ioMock).toHaveBeenCalledTimes(1));
    const opts = (ioMock.mock.calls[0] as unknown[]).find(
      (a): a is Record<string, any> => typeof a === 'object' && a !== null && 'path' in a,
    )!;
    expect(opts).toMatchObject({ path: '/api/socket.io' });
    expect(JSON.stringify(opts.auth)).toContain(JSON.stringify(INIT_DATA));

    act(() => sock.fire('connect'));
    const keyCalls = () =>
      invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as any)?.queryKey));
    expect(keyCalls()).not.toContain(JSON.stringify(tmaKeys.me));

    act(() => sock.fire('payment.settled', { productId: 'premium', paymentId: 'p-9' }));
    expect(handler).toHaveBeenCalledWith({ productId: 'premium', paymentId: 'p-9' });

    act(() => {
      sock.fire('disconnect', 'transport close');
      sock.fireManager('reconnect', 1);
      sock.fire('connect');
    });
    await waitFor(() => {
      expect(keyCalls()).toContain(JSON.stringify(tmaKeys.me));
      expect(keyCalls()).toContain(JSON.stringify(tmaKeys.entitlements));
    });
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});
