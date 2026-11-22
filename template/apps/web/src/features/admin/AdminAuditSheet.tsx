import type { AuditEvent } from '@pctea/tma/web';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminAudit } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { dateTime } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { useDebounced } from '../../components/useDebounced';
import { pop, push } from '../../state/stack';
import s from './Admin.module.css';

function parseTarget(raw: string): { targetType?: string; targetId?: string } {
  const [type, ...rest] = raw.trim().split(':');
  const id = rest.join(':').trim();
  return {
    ...(type ? { targetType: type.trim() } : {}),
    ...(id ? { targetId: id } : {}),
  };
}

function EventRow({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const targetUser = event.targetType === 'user' && event.targetId ? Number(event.targetId) : null;
  const hasMeta = event.meta !== null && event.meta !== undefined;

  return (
    <li className={s.auditRow}>
      <div className={s.auditHead}>
        <b>{event.action}</b>
        <span className={s.side}>{dateTime(event.at)}</span>
      </div>
      <div className={s.auditLinks}>
        {event.actorId !== null ? (
          <button
            type="button"
            className={s.rowAction}
            onClick={() => push({ kind: 'adminUser', props: { id: event.actorId } })}
          >
            {t('admin.auditActor', { id: event.actorId })}
          </button>
        ) : (
          <span className={s.hint}>{t('admin.auditSystem')}</span>
        )}
        {event.targetType &&
          (targetUser !== null && Number.isSafeInteger(targetUser) ? (
            <button
              type="button"
              className={s.rowAction}
              onClick={() => push({ kind: 'adminUser', props: { id: targetUser } })}
            >
              {t('admin.auditTarget', { target: `${event.targetType}:${event.targetId}` })}
            </button>
          ) : (
            <span className={s.hint}>
              {t('admin.auditTarget', {
                target: event.targetId ? `${event.targetType}:${event.targetId}` : event.targetType,
              })}
            </span>
          ))}
        {hasMeta && (
          <button
            type="button"
            className={s.rowAction}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {t('admin.auditMeta')}
          </button>
        )}
      </div>
      {open && hasMeta && <pre className={s.pre}>{JSON.stringify(event.meta, null, 2)}</pre>}
    </li>
  );
}

export function AdminAuditSheet() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const debouncedActor = useDebounced(actor.trim());
  const debouncedTarget = useDebounced(target);
  const actorId = /^\d{1,16}$/.test(debouncedActor) ? Number(debouncedActor) : undefined;
  const audit = useAdminAudit({
    ...(actorId !== undefined ? { actorId } : {}),
    ...parseTarget(debouncedTarget),
  });
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Sheet open onClose={pop} title={t('admin.auditTitle')}>
      <input
        className={s.search}
        type="search"
        inputMode="numeric"
        placeholder={t('admin.auditActorFilter')}
        aria-label={t('admin.auditActorFilter')}
        value={actor}
        onChange={(e) => setActor(e.target.value)}
      />
      <input
        className={`${s.search} ${s.gap}`}
        type="search"
        placeholder={t('admin.auditTargetFilter')}
        aria-label={t('admin.auditTargetFilter')}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />

      {rows.length > 0 && (
        <ul className={`${s.list} ${s.flat}`}>
          {rows.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      )}

      {audit.hasNextPage && (
        <button
          type="button"
          className={s.topBtn}
          disabled={audit.isFetchingNextPage}
          onClick={() => void audit.fetchNextPage()}
        >
          {t('common.more')}
        </button>
      )}
      {audit.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {audit.isSuccess && rows.length === 0 && <p className={s.status}>{t('admin.noAudit')}</p>}
      {audit.isError && (
        <p className={s.error} role="alert">
          {errorMessage(audit.error)}
        </p>
      )}
    </Sheet>
  );
}
