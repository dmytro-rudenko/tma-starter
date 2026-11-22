import { useTranslation } from 'react-i18next';
import { useAdminBroadcasts } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { dateTime } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { pop, push } from '../../state/stack';
import s from './Admin.module.css';

export function AdminBroadcastsSheet() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const broadcasts = useAdminBroadcasts();
  const rows = broadcasts.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Sheet open onClose={pop} title={t('admin.broadcastsTitle')}>
      <button
        type="button"
        className={s.topBtn}
        onClick={() => push({ kind: 'adminBroadcastNew', props: {} })}
      >
        {t('admin.broadcastNew')}
      </button>

      {rows.length > 0 && (
        <div className={s.list}>
          {rows.map((b) => (
            <button
              key={b.id}
              type="button"
              className={s.row}
              onClick={() => push({ kind: 'adminBroadcast', props: { id: b.id } })}
            >
              <div className={s.who}>
                <b>
                  <span>{b.text.replace(/<[^>]*>/g, '')}</span>
                </b>
                <span>
                  {dateTime(b.createdAt)} · {t(`admin.broadcastStatus.${b.status}`)}
                </span>
              </div>
              <div className={s.side}>
                {b.sent}/{b.total}
                {b.failed > 0 && (
                  <>
                    <br />
                    {t('admin.broadcastFailed', { count: b.failed })}
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {broadcasts.hasNextPage && (
        <button
          type="button"
          className={s.topBtn}
          disabled={broadcasts.isFetchingNextPage}
          onClick={() => void broadcasts.fetchNextPage()}
        >
          {t('common.more')}
        </button>
      )}
      {broadcasts.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {broadcasts.isSuccess && rows.length === 0 && (
        <p className={s.status}>{t('admin.noBroadcasts')}</p>
      )}
      {broadcasts.isError && (
        <p className={s.error} role="alert">
          {errorMessage(broadcasts.error)}
        </p>
      )}
    </Sheet>
  );
}
