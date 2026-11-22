import { useEntitlement, useProducts, usePurchase } from '@pctea/tma/web/react';
import type { ProductDto } from '@pctea/tma/web';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../api/errorText';
import { day } from '../../components/format';
import { toast } from '../../components/Toast';
import a from '../admin/Admin.module.css';
import h from '../home/HomeScreen.module.css';
import s from '../settings/SettingsTab.module.css';

function ProductRow({
  product,
  paying,
  onBuy,
}: {
  product: ProductDto;
  paying: boolean;
  onBuy: (productId: string) => void;
}) {
  const { t } = useTranslation();
  const owned = useEntitlement(product.id);
  const hasIt = owned.active && !product.repeatable;

  return (
    <li className={s.row}>
      <div className={a.who}>
        <b>
          <span>{product.title}</span>
        </b>
        <span>{product.description}</span>
        <span>{t('common.stars', { count: product.priceStars })}</span>
      </div>
      {hasIt ? (
        <i className={`${a.tag} ${a.accent}`}>
          {owned.expiresAt
            ? t('shop.activeUntil', { date: day(owned.expiresAt) })
            : t('shop.active')}
        </i>
      ) : (
        <button
          type="button"
          className={a.rowAction}
          disabled={paying}
          onClick={() => onBuy(product.id)}
        >
          {product.kind === 'subscription' ? t('shop.subscribe') : t('shop.buy')}
        </button>
      )}
    </li>
  );
}

export function ShopTab() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const products = useProducts();
  const { purchase, status } = usePurchase();

  const buy = async (productId: string) => {
    try {
      const outcome = await purchase({ productId });
      if (outcome === 'failed') toast(t('shop.failed'));
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  return (
    <>
      <div className={h.largeTitle}>
        <h1>{t('shop.title')}</h1>
      </div>
      <section className={s.sec}>
        {products.isLoading && <p>{t('common.loading')}</p>}
        {products.isError && <p>{errorMessage(products.error)}</p>}
        {products.data?.length === 0 && <p>{t('shop.empty')}</p>}
        {!!products.data?.length && (
          <ul className={s.list}>
            {products.data.map((p) => (
              <ProductRow key={p.id} product={p} paying={status === 'paying'} onBuy={buy} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
