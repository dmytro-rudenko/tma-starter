import type { QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  const handlers = new Map<string, Handler[]>();
  const manager = { on: () => manager, off: () => manager };
  const socket = {
    connected: false,
    io: manager,
    on(e: string, h: Handler) {
      handlers.set(e, [...(handlers.get(e) ?? []), h]);
      return socket;
    },
    off(e: string, h?: Handler) {
      if (h) handlers.set(e, (handlers.get(e) ?? []).filter((x) => x !== h));
      else handlers.delete(e);
      return socket;
    },
    emit: () => socket,
    connect: () => socket,
    disconnect: () => socket,
    close: () => socket,
  };
  return { socket, reset: () => handlers.clear() };
});

vi.mock('socket.io-client', () => {
  const io = () => sock.socket;
  return { io, default: io };
});

import { createI18n } from '@dmytro-rudenko/tma-web';
import { TmaProvider, createQueryClient, tmaKeys, usePurchase } from '@dmytro-rudenko/tma-web/react';
import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';

const INIT_DATA = 'query_id=AAH1&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Olia%22%7D&auth_date=1700000000&hash=abc';

type SdkStatus = 'paid' | 'cancelled' | 'failed' | 'pending' | null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function wrapperFor(qc: QueryClient) {
  const i18n = createI18n({
    resources: { en: { translation: {} }, uk: { translation: {} } },
    supported: ['uk', 'en'],
    fallback: 'en',
  });
  return ({ children }: { children: ReactNode }) => (
    <TmaProvider client={qc} i18n={i18n.i18n}>
      {children}
    </TmaProvider>
  );
}

function setup(invoice: () => Response, sdkStatus: SdkStatus) {
  sock.reset();
  const notify = vi.fn();
  const openInvoice = vi.fn((_url: string, cb: (s: string) => void) => {
    if (sdkStatus) cb(sdkStatus);
  });
  installFakeWebApp(window, {
    initData: INIT_DATA,
    openInvoice,
    HapticFeedback: { notificationOccurred: notify, impactOccurred: vi.fn(), selectionChanged: vi.fn() },
  });
  const invoiceBodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/api/payments/invoice') && init.method === 'POST') {
        invoiceBodies.push(JSON.parse(String(init.body)));
        return invoice();
      }
      return json(200, url.endsWith('/api/me') ? { id: 42 } : []);
    }),
  );
  const qc = createQueryClient();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const hook = renderHook(() => usePurchase(), { wrapper: wrapperFor(qc) });
  const keys = () =>
    [...new Set(invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as any)?.queryKey)))].sort();
  return { hook, notify, openInvoice, invoiceBodies, keys };
}

const ALL_KEYS = () => [tmaKeys.me, tmaKeys.entitlements, tmaKeys.products].map((k) => JSON.stringify(k)).sort();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as any).Telegram;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('usePurchase', () => {
  it("settled: notifies 'success' once and invalidates me, entitlements, products", async () => {
    const { hook, notify, keys } = setup(() => json(200, { settled: true }), null);
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('paid'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('success');
    await waitFor(() => expect(keys()).toEqual(ALL_KEYS()));
  });

  it("paid: notifies 'success' once and invalidates exactly me, entitlements, products", async () => {
    const { hook, notify, keys } = setup(() => json(200, { invoiceLink: 'https://t.me/$inv1' }), 'paid');
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('paid'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('success');
    expect(keys()).toEqual(ALL_KEYS());
  });

  it("cancelled: notifies 'warning' and invalidates nothing", async () => {
    const { hook, notify, keys } = setup(() => json(200, { invoiceLink: 'https://t.me/$inv2' }), 'cancelled');
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('cancelled'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('warning');
    expect(keys()).toEqual([]);
  });

  it("failed: notifies 'error' and invalidates nothing", async () => {
    const { hook, notify, keys } = setup(() => json(200, { invoiceLink: 'https://t.me/$inv3' }), 'failed');
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('failed'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('error');
    expect(keys()).toEqual([]);
  });

  it("invoice API error: status 'failed', notifies 'error', never opens the invoice", async () => {
    const { hook, notify, openInvoice } = setup(
      () =>
        json(409, { statusCode: 409, message: 'Already owned', error: 'Conflict', code: 'ALREADY_OWNED' }),
      'paid',
    );
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' }).catch(() => undefined);
    });
    await waitFor(() => expect(hook.result.current.status).toBe('failed'));
    expect(openInvoice).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('error');
  });

  it('sends targetId with the invoice request', async () => {
    const { hook, invoiceBodies } = setup(() => json(200, { invoiceLink: 'https://t.me/$inv4' }), 'paid');
    act(() => {
      void hook.result.current.purchase({ productId: 'gift', targetId: 7 });
    });
    await waitFor(() => expect(hook.result.current.status).toBe('paid'));
    expect(invoiceBodies).toEqual([{ productId: 'gift', targetId: 7 }]);
  });

  it('pending: invalidates entitlements after the 5 s fallback without payment.settled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { hook, openInvoice, keys } = setup(() => json(200, { invoiceLink: 'https://t.me/$inv5' }), 'pending');
    act(() => {
      void hook.result.current.purchase({ productId: 'premium' });
    });
    await waitFor(() => expect(openInvoice).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(keys()).not.toContain(JSON.stringify(tmaKeys.entitlements));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(keys()).toContain(JSON.stringify(tmaKeys.entitlements));
  });
});
