import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { createPrefsCache, tg } from '@dmytro-rudenko/tma-web';

const zero = { top: 0, bottom: 0, left: 0, right: 0 };
const root = () => document.documentElement.style;

type Listener = () => void;

function eventBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    onEvent(event: string, cb: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
    },
    offEvent(event: string, cb: Listener) {
      listeners.get(event)?.delete(cb);
    },
    fire(event: string) {
      for (const cb of listeners.get(event) ?? []) cb();
    },
    count() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
    events() {
      return [...listeners.entries()].filter(([, s]) => s.size > 0).map(([e]) => e);
    },
  };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).Telegram;
  delete (window as any).__tgCalls;
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
});

describe('tg.isVersionAtLeast', () => {
  it('returns false outside Telegram', () => {
    expect(tg.isVersionAtLeast('6.0')).toBe(false);
  });

  it('compares against WebApp.version', () => {
    installFakeWebApp(window, { version: '8.0' });
    expect(tg.isVersionAtLeast('7.10')).toBe(true);
    expect(tg.isVersionAtLeast('8.0')).toBe(true);
    expect(tg.isVersionAtLeast('8.1')).toBe(false);
    expect(tg.isVersionAtLeast('9')).toBe(false);
  });

  it('returns false when the SDK throws', () => {
    installFakeWebApp(window, {
      isVersionAtLeast: () => {
        throw new Error('boom');
      },
    });
    expect(tg.isVersionAtLeast('6.0')).toBe(false);
  });
});

describe('tg.syncSafeArea', () => {
  it('writes safe-area and content-safe-area CSS vars', () => {
    installFakeWebApp(window, {
      platform: 'ios',
      isFullscreen: true,
      safeAreaInset: { ...zero, top: 47, bottom: 34 },
      contentSafeAreaInset: { ...zero, top: 46 },
    });
    const off = tg.syncSafeArea();
    expect(root().getPropertyValue('--tg-safe-area-inset-top')).toBe('47px');
    expect(root().getPropertyValue('--tg-safe-area-inset-bottom')).toBe('34px');
    expect(root().getPropertyValue('--tg-content-safe-area-inset-top')).toBe('46px');
    expect(root().getPropertyValue('--tg-content-safe-area-inset-bottom')).toBe('0px');
    off();
  });

  it('follows safe-area events and stops after unsubscribe', () => {
    const bus = eventBus();
    const app = installFakeWebApp(window, {
      platform: 'ios',
      isFullscreen: true,
      safeAreaInset: { ...zero, top: 20 },
      contentSafeAreaInset: zero,
      onEvent: bus.onEvent,
      offEvent: bus.offEvent,
    });
    const off = tg.syncSafeArea();
    expect(bus.events()).toEqual(expect.arrayContaining(['safeAreaChanged', 'contentSafeAreaChanged']));

    app.safeAreaInset = { ...zero, top: 59 };
    bus.fire('safeAreaChanged');
    expect(root().getPropertyValue('--tg-safe-area-inset-top')).toBe('59px');

    app.contentSafeAreaInset = { ...zero, top: 12 };
    bus.fire('contentSafeAreaChanged');
    expect(root().getPropertyValue('--tg-content-safe-area-inset-top')).toBe('12px');

    off();
    expect(bus.count()).toBe(0);

    app.safeAreaInset = { ...zero, top: 99 };
    bus.fire('safeAreaChanged');
    expect(root().getPropertyValue('--tg-safe-area-inset-top')).toBe('59px');
  });
});

describe('tg.startParam', () => {
  it('prefers initDataUnsafe.start_param', () => {
    window.history.replaceState(null, '', '/?tgWebAppStartParam=from_query');
    installFakeWebApp(window, { initData: 'auth_date=1700000000&start_param=from_tg&hash=abc' });
    expect(tg.startParam()).toBe('from_tg');
  });

  it('falls back to the tgWebAppStartParam query', () => {
    window.history.replaceState(null, '', '/?tgWebAppStartParam=ref_42');
    installFakeWebApp(window, { initData: 'auth_date=1700000000&hash=abc' });
    expect(tg.startParam()).toBe('ref_42');
  });

  it('falls back to the query outside Telegram', () => {
    window.history.replaceState(null, '', '/?tgWebAppStartParam=ref_7');
    expect(tg.startParam()).toBe('ref_7');
  });

  it('is undefined when neither is present', () => {
    installFakeWebApp(window, { initData: 'auth_date=1700000000&hash=abc' });
    expect(tg.startParam()).toBeUndefined();
  });
});

describe('tg.shareMessage', () => {
  it("returns 'unsupported' outside Telegram", async () => {
    expect(await tg.shareMessage('msg-1')).toBe('unsupported');
  });

  it("returns 'unsupported' when the SDK lacks shareMessage", async () => {
    installFakeWebApp(window, { shareMessage: undefined });
    expect(await tg.shareMessage('msg-1')).toBe('unsupported');
  });

  it("returns 'unsupported' when shareMessage throws", async () => {
    installFakeWebApp(window, {
      shareMessage: () => {
        throw new Error('WebAppMethodUnsupported');
      },
    });
    expect(await tg.shareMessage('msg-1')).toBe('unsupported');
  });

  it("maps the callback to 'sent' and 'cancelled'", async () => {
    const shareMessage = vi.fn((_id: string, cb: (sent: boolean) => void) => cb(true));
    installFakeWebApp(window, { shareMessage });
    expect(await tg.shareMessage('msg-1')).toBe('sent');
    expect(shareMessage).toHaveBeenCalledWith('msg-1', expect.any(Function));

    installFakeWebApp(window, {
      shareMessage: (_id: string, cb: (sent: boolean) => void) => cb(false),
    });
    expect(await tg.shareMessage('msg-2')).toBe('cancelled');
  });

  it('canShareMessage needs shareMessage and Bot API 8.0', () => {
    installFakeWebApp(window, { version: '8.0' });
    expect(tg.canShareMessage()).toBe(true);
    installFakeWebApp(window, { version: '7.10' });
    expect(tg.canShareMessage()).toBe(false);
    installFakeWebApp(window, { version: '8.0', shareMessage: undefined });
    expect(tg.canShareMessage()).toBe(false);
  });
});

describe('createPrefsCache', () => {
  it('writes, merges and reads prefs under its key', () => {
    const cache = createPrefsCache('demo.prefs');
    cache.write({ theme: 'dark' });
    cache.write({ language: 'uk' });
    expect(cache.read()).toEqual({ theme: 'dark', language: 'uk' });
    expect(JSON.parse(localStorage.getItem('demo.prefs')!)).toEqual({ theme: 'dark', language: 'uk' });
  });

  it('reads {} from corrupt storage', () => {
    localStorage.setItem('demo.prefs', 'not json');
    expect(createPrefsCache('demo.prefs').read()).toEqual({});
  });

  it('restore applies the cached theme', () => {
    createPrefsCache('demo.prefs').write({ theme: 'dark' });
    createPrefsCache('demo.prefs').restore();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores storage methods that throw', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    const cache = createPrefsCache('demo.prefs');
    expect(() => cache.write({ theme: 'dark' })).not.toThrow();
    expect(cache.read()).toEqual({});
    expect(() => cache.restore()).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('ignores a localStorage accessor that throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const cache = createPrefsCache('demo.prefs');
      expect(() => cache.write({ theme: 'dark' })).not.toThrow();
      expect(cache.read()).toEqual({});
      expect(() => cache.restore()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', original!);
    }
  });
});
