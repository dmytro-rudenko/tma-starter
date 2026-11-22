import { useMe } from 'tma-starter/web/react';
import { useTranslation } from 'react-i18next';
// tma:shop:start
import { PremiumBlock } from '../shop/PremiumBlock';
// tma:shop:end
import s from './HomeScreen.module.css';

export function HomeScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const name = me.data?.firstName;

  return (
    <>
      <div className={s.largeTitle}>
        <h1>{t('app.title')}</h1>
      </div>
      <section className={s.card}>
        <h2>{name ? t('home.greeting', { name }) : t('home.welcome')}</h2>
        <p>{t('home.hint')}</p>
      </section>
      {/* tma:shop:start */}
      <PremiumBlock />
      {/* tma:shop:end */}
    </>
  );
}
