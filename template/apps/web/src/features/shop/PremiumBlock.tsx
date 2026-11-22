import { useEntitlement, useTma } from '@dmytro-rudenko/tma-web/react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../api/errorText';
import { push } from '../../state/stack';
import a from '../admin/Admin.module.css';
import s from '../home/HomeScreen.module.css';
import { PREMIUM_PRODUCT } from './PaywallSheet';

export function PremiumBlock() {
  const { t } = useTranslation();
  const premium = useEntitlement(PREMIUM_PRODUCT);

  return (
    <section className={s.card}>
      <h2>{t('shop.premium.title')}</h2>
      {premium.active ? (
        <PremiumContent />
      ) : (
        !premium.isLoading && (
          <>
            <p>{t('shop.premium.locked')}</p>
            <button
              type="button"
              className={`${a.act} ${a.primary} ${a.wide}`}
              onClick={() => push({ kind: 'paywall', props: {} })}
            >
              {t('shop.premium.unlock')}
            </button>
          </>
        )
      )}
    </section>
  );
}

function PremiumContent() {
  const { t } = useTranslation();
  const { apiClient } = useTma();
  const errorMessage = useErrorMessage();
  const content = useQuery({
    queryKey: ['premium', 'content'],
    queryFn: () => apiClient.request<{ items: string[] }>('/api/premium/content'),
  });

  if (content.isError) return <p>{errorMessage(content.error)}</p>;
  if (!content.data) return <p>{t('common.loading')}</p>;
  return (
    <ul>
      {content.data.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
