import { tg, type PaymentStatus } from '@pctea/tma-web';
import { useTma } from '@pctea/tma-web/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminPayments } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { dateTime, day } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { pop, push } from '../../state/stack';
import s from './Admin.module.css';

interface MissingPayment {
  chargeId: string;
  userId: number;
  amountStars: number;
  date: string;
}

interface ReconcileReport {
  checked: number;
  invoicePayments: number;
  missing: MissingPayment[];
}

const STATUSES: readonly (PaymentStatus | '')[] = ['', 'paid', 'refund_pending', 'refunded'];

export function AdminPaymentsSheet() {
  const { t } = useTranslation();
  const { api } = useTma();
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<PaymentStatus | ''>('');
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [busy, setBusy] = useState(false);
  const payments = useAdminPayments(status);
  const rows = payments.data?.pages.flatMap((p) => p.items) ?? [];

  const reconcile = async () => {
    setBusy(true);
    try {
      setReport((await api.admin.payments.reconcile()) as ReconcileReport);
      tg.haptic.notify('success');
    } catch (e) {
      tg.haptic.notify('error');
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={pop} title={t('admin.paymentsTitle')}>
      <div className={s.seg} role="group" aria-label={t('admin.payStatusFilter')}>
        {STATUSES.map((v) => (
          <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)}>
            {v ? t(`admin.payStatus.${v}`) : t('admin.payStatusAll')}
          </button>
        ))}
      </div>
      <button type="button" className={s.topBtn} disabled={busy} onClick={() => void reconcile()}>
        {t('admin.reconcile')}
      </button>

      {report && (
        <div className={s.report}>
          <p className={s.line}>
            {t('admin.reconcileSummary', {
              checked: report.checked,
              payments: report.invoicePayments,
              missing: report.missing.length,
            })}
          </p>
          {report.missing.map((m) => (
            <p key={m.chargeId} className={s.line}>
              <span className="mono">{m.chargeId}</span>
              {' · '}
              {t('common.stars', { count: m.amountStars })}
              {' · '}
              {m.userId ? `ID ${m.userId}` : t('admin.reconcileUnknownUser')}
              {' · '}
              {dateTime(m.date)}
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className={`${s.list} ${s.flat}`}>
          {rows.map((p) => (
            <button
              key={p.id}
              type="button"
              className={s.row}
              onClick={() => push({ kind: 'adminUser', props: { id: p.payerId } })}
            >
              <div className={s.who}>
                <b>
                  <span>
                    {p.productId} · {t('common.stars', { count: p.amountStars })}
                  </span>
                </b>
                <span>
                  ID {p.payerId} · {day(p.createdAt)}
                </span>
              </div>
              <div className={s.side}>{t(`admin.payStatus.${p.status}`)}</div>
            </button>
          ))}
        </div>
      )}

      {payments.hasNextPage && (
        <button
          type="button"
          className={s.topBtn}
          disabled={payments.isFetchingNextPage}
          onClick={() => void payments.fetchNextPage()}
        >
          {t('common.more')}
        </button>
      )}
      {payments.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {payments.isSuccess && rows.length === 0 && (
        <p className={s.status}>{t('admin.noPayments')}</p>
      )}
      {payments.isError && (
        <p className={s.error} role="alert">
          {errorMessage(payments.error)}
        </p>
      )}
    </Sheet>
  );
}
