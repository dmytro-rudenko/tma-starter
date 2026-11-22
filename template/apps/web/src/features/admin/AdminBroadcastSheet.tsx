import { tg } from 'tma-starter/web';
import { useTma } from 'tma-starter/web/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminKeys, useAdminBroadcast } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { dateTime } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { pop } from '../../state/stack';
import s from './Admin.module.css';
import { AdminConfirm } from './AdminConfirm';

export function AdminBroadcastSheet({ id }: { id: string }) {
  const { t } = useTranslation();
  const { api } = useTma();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const query = useAdminBroadcast(id);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const b = query.data;
  const cancellable = b?.status === 'queued' || b?.status === 'running';
  const percent =
    b && b.total > 0 ? Math.min(100, Math.round(((b.sent + b.failed) / b.total) * 100)) : 0;

  const cancel = async () => {
    setBusy(true);
    try {
      const next = await api.admin.broadcasts.cancel(id);
      qc.setQueryData(adminKeys.broadcast(id), next);
      void qc.invalidateQueries({ queryKey: adminKeys.broadcasts });
      tg.haptic.notify('success');
      toast(t('admin.broadcastCanceled'));
      setAsking(false);
    } catch (e) {
      tg.haptic.notify('error');
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={pop} title={t('admin.broadcastTitle')}>
      {b && (
        <>
          <div className={s.broadcastText}>{b.text}</div>
          {b.button && (
            <p className={s.line}>
              {t('admin.broadcastButton', { text: b.button.text })}
              {b.button.startParam ? ` (${b.button.startParam})` : ''}
            </p>
          )}
          <div
            className={s.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <i style={{ width: `${percent}%` }} />
          </div>
          <div className={s.stats}>
            <span>{t('admin.broadcastSent', { sent: b.sent, total: b.total })}</span>
            <span>{t('admin.broadcastFailed', { count: b.failed })}</span>
            <span>{t(`admin.broadcastStatus.${b.status}`)}</span>
          </div>
          <p className={s.meta}>
            {t('admin.broadcastCreated', { date: dateTime(b.createdAt) })}
            {b.finishedAt
              ? ` · ${t('admin.broadcastFinished', { date: dateTime(b.finishedAt) })}`
              : ''}
          </p>
          {cancellable && !asking && (
            <button
              type="button"
              className={`${s.act} ${s.danger} ${s.wide}`}
              onClick={() => setAsking(true)}
            >
              {t('admin.broadcastCancel')}
            </button>
          )}
          {asking && (
            <AdminConfirm
              danger
              text={t('admin.broadcastCancelConfirm')}
              yes={t('admin.broadcastCancel')}
              pending={busy}
              onCancel={() => setAsking(false)}
              onYes={() => void cancel()}
            />
          )}
        </>
      )}
      {query.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {query.isError && (
        <p className={s.error} role="alert">
          {errorMessage(query.error)}
        </p>
      )}
    </Sheet>
  );
}
