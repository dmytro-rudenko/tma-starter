import { tg } from 'tma-starter/web';
import {
  TmaProvider,
  createQueryClient,
  useMe,
  useRealtimeEvent,
} from 'tma-starter/web/react';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from './api/client';
import { BlockedScreen } from './components/BlockedScreen';
import { ToastHost, toast } from './components/Toast';
import { MainScreen } from './features/nav/MainScreen';
import { registry } from './features/registry';
import { i18n } from './i18n';
import { FULLSCREEN_KINDS, LayerContext, useStack } from './state/stack';
// tma:shop:start
import { setTab } from './state/tabs';
// tma:shop:end

export function routeStartParam(param: string | null | undefined): void {
  if (!param) return;
  // tma:shop:start
  if (param === 'shop') setTab('shop');
  // tma:shop:end
}

function Shell() {
  const { t } = useTranslation();
  const stack = useStack();
  const me = useMe();
  const routed = useRef(false);

  useRealtimeEvent('payment.settled', () => toast(t('realtime.paymentSettled')));

  const meSettled = me.isSuccess || me.isError;
  useEffect(() => {
    if (!meSettled || routed.current) return;
    routed.current = true;
    routeStartParam(tg.startParam());
  }, [meSettled]);

  if (me.blocked) return <BlockedScreen />;

  const topIndex = stack.length - 1;
  const sheetOpen = stack.some((e) => !FULLSCREEN_KINDS.has(e.kind));

  return (
    <>
      <MainScreen under={sheetOpen} />
      {stack.map((entry, i) => {
        const Component = registry[entry.kind];
        return (
          <LayerContext.Provider key={i} value={{ index: i, isTop: i === topIndex, entry }}>
            <Component {...entry.props} />
          </LayerContext.Provider>
        );
      })}
      <ToastHost />
    </>
  );
}

export function App({ client }: { client?: QueryClient }) {
  const [qc] = useState(() => client ?? createQueryClient());
  return (
    <TmaProvider client={qc} i18n={i18n} apiClient={apiClient}>
      <Shell />
    </TmaProvider>
  );
}
