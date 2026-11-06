import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { i18n as I18n } from 'i18next';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import { createApiClient, type ApiClient } from '../api.js';
import { i18nControls, type Lang } from '../i18n.js';
import { createPrefsCache, type PrefsCache } from '../prefs.js';
import { connectRealtime } from '../realtime.js';
import { applyTheme, watchSystemTheme, type ThemePref } from '../theme.js';
import { tg, type ChromeColors } from '../tg.js';
import { tmaApi, type TmaApi } from '../tma-api.js';
import { tmaKeys } from './keys.js';

type Handler = (payload: unknown) => void;

export interface RealtimeHub {
  subscribe(event: string, handler: Handler): () => void;
  close(): void;
}

export interface TmaContextValue {
  api: TmaApi;
  apiClient: ApiClient;
  i18n: I18n;
  prefs: PrefsCache;
  realtime: RealtimeHub;
  applyPrefs(p: { theme?: ThemePref; language?: Lang | null }): void;
}

const TmaContext = createContext<TmaContextValue | null>(null);

export function useTma(): TmaContextValue {
  const ctx = useContext(TmaContext);
  if (!ctx) throw new Error('useTma must be used inside <TmaProvider>');
  return ctx;
}

function createRealtimeHub(qc: QueryClient, path?: string): RealtimeHub {
  let socket: Socket | null | undefined;
  const listeners = new Map<string, Set<Handler>>();
  const bound = new Set<string>();

  const bind = (event: string) => {
    if (!socket || bound.has(event)) return;
    bound.add(event);
    socket.on(event, (payload: unknown) => {
      for (const h of [...(listeners.get(event) ?? [])]) h(payload);
    });
  };

  const ensure = () => {
    if (socket !== undefined) return;
    socket = connectRealtime(path ? { path } : {});
    if (!socket) return;
    let connectedOnce = false;
    socket.on('connect', () => {
      if (connectedOnce) {
        void qc.invalidateQueries({ queryKey: tmaKeys.me });
        void qc.invalidateQueries({ queryKey: tmaKeys.entitlements });
      }
      connectedOnce = true;
    });
    for (const event of listeners.keys()) bind(event);
  };

  return {
    subscribe(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      ensure();
      bind(event);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },
    close() {
      socket?.disconnect();
      socket = undefined;
      bound.clear();
    },
  };
}

export interface TmaProviderProps {
  client: QueryClient;
  i18n: I18n;
  chrome?: ChromeColors;
  apiClient?: ApiClient;
  prefsKey?: string;
  realtimePath?: string;
  children?: ReactNode;
}

export function TmaProvider({
  client,
  i18n,
  chrome,
  apiClient,
  prefsKey = 'tma.prefs',
  realtimePath,
  children,
}: TmaProviderProps) {
  const [value] = useState<TmaContextValue>(() => {
    const http = apiClient ?? createApiClient();
    const prefs = createPrefsCache(prefsKey);
    const applyLanguage = (pref: Lang | null) => {
      const controls = i18nControls(i18n);
      if (controls) controls.applyLanguagePref(pref);
      else void i18n.changeLanguage(pref ?? tg.languageCode());
    };
    prefs.restore(applyLanguage);
    return {
      api: tmaApi(http),
      apiClient: http,
      i18n,
      prefs,
      realtime: createRealtimeHub(client, realtimePath),
      applyPrefs(p) {
        if (p.theme) applyTheme(p.theme);
        if (p.language !== undefined) applyLanguage(p.language);
        const cached: { theme?: ThemePref; language?: Lang | null } = {};
        if (p.theme) cached.theme = p.theme;
        if (p.language !== undefined) cached.language = p.language;
        prefs.write(cached);
      },
    };
  });

  useEffect(() => {
    tg.init(chrome ? { chrome } : {});
    const painted = document.documentElement.dataset.theme;
    if (painted === 'light' || painted === 'dark') tg.applyChrome(painted);
    const offSafeArea = tg.syncSafeArea();
    const offTheme = watchSystemTheme();
    return () => {
      offSafeArea();
      offTheme();
    };
  }, []);

  useEffect(() => () => value.realtime.close(), [value]);

  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <TmaContext.Provider value={value}>{children}</TmaContext.Provider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
