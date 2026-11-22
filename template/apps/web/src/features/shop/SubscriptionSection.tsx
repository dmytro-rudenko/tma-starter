import type { EntitlementDto } from 'tma-starter/web';
import { tmaKeys, useProducts, useTma } from 'tma-starter/web/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../api/errorText';
import { day } from '../../components/format';
import { toast } from '../../components/Toast';
import a from '../admin/Admin.module.css';
import s from '../settings/SettingsTab.module.css';

export function SubscriptionSection() {
  const { t } = useTranslation();
  const { api } = useTma();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const products = useProducts();
  const entitlements = useQuery({
    queryKey: tmaKeys.entitlements,
    queryFn: () => api.entitlements(),
  });
  const [busy, setBusy] = useState(false);
  const subscriptions = (entitlements.data ?? []).filter((e) => e.source === 'subscription');

  if (subscriptions.length === 0) return null;

  const toggle = async (e: EntitlementDto) => {
    setBusy(true);
    try {
      await (e.canceled
        ? api.resumeSubscription(e.productId)
        : api.cancelSubscription(e.productId));
      await qc.invalidateQueries({ queryKey: tmaKeys.entitlements });
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.sec}>
      <h3>{t('shop.subscription.title')}</h3>
      <ul className={s.list}>
        {subscriptions.map((e) => (
          <li key={e.productId} className={s.row}>
            <div className={a.who}>
              <b>
                <span>
                  {products.data?.find((p) => p.id === e.productId)?.title ?? e.productId}
                </span>
              </b>
              <span>
                {e.expiresAt
                  ? t(
                      e.canceled
                        ? 'shop.subscription.canceledUntil'
                        : 'shop.subscription.nextCharge',
                      {
                        date: day(e.expiresAt),
                      },
                    )
                  : ''}
              </span>
            </div>
            <button
              type="button"
              className={a.rowAction}
              disabled={busy}
              onClick={() => void toggle(e)}
            >
              {e.canceled ? t('shop.subscription.resume') : t('shop.subscription.cancel')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
