import { useTranslation } from 'react-i18next';
import s from './Admin.module.css';

export interface AdminConfirmProps {
  text: string;
  yes: string;
  pending: boolean;
  danger?: boolean;
  onCancel: () => void;
  onYes: () => void;
}

export function AdminConfirm({ text, yes, pending, danger, onCancel, onYes }: AdminConfirmProps) {
  const { t } = useTranslation();
  return (
    <div className={s.confirm} role="alertdialog">
      <p>{text}</p>
      <div className={s.two}>
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={danger ? s.d : undefined}
          disabled={pending}
          onClick={onYes}
        >
          {yes}
        </button>
      </div>
    </div>
  );
}
