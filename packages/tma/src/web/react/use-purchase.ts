import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { tg, type NotifyType } from '../tg.js';
import type { TargetId } from '../tma-api.js';
import { tmaKeys } from './keys.js';
import { useTma } from './provider.js';

export type PurchaseStatus = 'idle' | 'paying' | 'paid' | 'cancelled' | 'failed';
export type PurchaseOutcome = 'paid' | 'cancelled' | 'failed' | 'pending';

const PENDING_FALLBACK_MS = 5000;
const HAPTIC: Record<Exclude<PurchaseStatus, 'idle' | 'paying'>, NotifyType> = {
  paid: 'success',
  cancelled: 'warning',
  failed: 'error',
};

export function usePurchase() {
  const { api, realtime } = useTma();
  const qc = useQueryClient();
  const [status, setStatus] = useState<PurchaseStatus>('idle');
  const pendingCleanup = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      pendingCleanup.current?.();
      pendingCleanup.current = null;
    },
    [],
  );

  const purchase = useCallback(
    async ({ productId, targetId }: { productId: string; targetId?: TargetId }): Promise<PurchaseOutcome> => {
      pendingCleanup.current?.();
      pendingCleanup.current = null;
      const invalidate = () => {
        void qc.invalidateQueries({ queryKey: tmaKeys.me });
        void qc.invalidateQueries({ queryKey: tmaKeys.entitlements });
        void qc.invalidateQueries({ queryKey: tmaKeys.products });
      };
      const finish = (s: 'paid' | 'cancelled' | 'failed') => {
        if (s === 'paid') invalidate();
        tg.haptic.notify(HAPTIC[s]);
        setStatus(s);
      };

      setStatus('paying');
      let res;
      try {
        res = await api.createInvoice(targetId === undefined ? { productId } : { productId, targetId });
      } catch (err) {
        finish('failed');
        throw err;
      }
      if ('settled' in res && res.settled) {
        finish('paid');
        return 'paid';
      }
      const outcome = await tg.openInvoice((res as { invoiceLink: string }).invoiceLink);
      if (outcome !== 'pending') {
        finish(outcome);
        return outcome;
      }

      return new Promise<PurchaseOutcome>((resolve) => {
        const settle = (result: PurchaseOutcome) => {
          clearTimeout(timer);
          off();
          if (pendingCleanup.current === abandon) pendingCleanup.current = null;
          resolve(result);
        };
        const abandon = () => settle('pending');
        const timer = setTimeout(() => {
          settle('pending');
          invalidate();
          setStatus('idle');
        }, PENDING_FALLBACK_MS);
        const off = realtime.subscribe('payment.settled', (payload) => {
          const settled = payload as { productId?: string } | undefined;
          if (settled?.productId && settled.productId !== productId) return;
          settle('paid');
          finish('paid');
        });
        pendingCleanup.current = abandon;
      });
    },
    [api, realtime, qc],
  );

  return { purchase, status };
}
