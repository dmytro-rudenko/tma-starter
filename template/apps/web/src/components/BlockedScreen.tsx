import { useTranslation } from 'react-i18next';
import s from './BlockedScreen.module.css';

export function BlockedScreen() {
  const { t } = useTranslation();
  return (
    <div className={s.blocked} role="alert">
      <h1>{t('blocked.title')}</h1>
      <p>{t('blocked.text')}</p>
    </div>
  );
}
