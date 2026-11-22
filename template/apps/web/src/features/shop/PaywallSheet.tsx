import { usePurchase, useProducts } from 'tma-starter/web/react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../api/errorText';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { pop, popEntry, useLayer } from '../../state/stack';
import a from '../admin/Admin.module.css';

export const PREMIUM_PRODUCT = 'premium';

export function PaywallSheet() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const product = useProducts().data?.find((p) => p.id === PREMIUM_PRODUCT);
  const { purchase, status } = usePurchase();
  const { entry } = useLayer();

  const subscribe = async () => {
    try {
      const outcome = await purchase({ productId: PREMIUM_PRODUCT });
      if (outcome === 'paid') popEntry(entry);
      else if (outcome === 'failed') toast(t('shop.failed'));
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <Sheet open onClose={pop} title={t('shop.paywall.title')}>
      <p className={a.line}>{t('shop.paywall.text')}</p>
      {product && <p className={a.line}>{t('common.stars', { count: product.priceStars })}</p>}
      <button
        type="button"
        className={`${a.act} ${a.primary} ${a.wide}`}
        disabled={!product || status === 'paying'}
        onClick={() => void subscribe()}
      >
        {t('shop.subscribe')}
      </button>
    </Sheet>
  );
}
