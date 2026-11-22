import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminUsers } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { Avatar } from '../../components/Avatar';
import { day, str } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { useDebounced } from '../../components/useDebounced';
import { pop, push } from '../../state/stack';
import s from './Admin.module.css';

export function AdminUsersSheet() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const users = useAdminUsers(query);
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Sheet open onClose={pop} title={t('admin.usersTitle')}>
      <input
        className={s.search}
        type="search"
        inputMode="search"
        placeholder={t('admin.search')}
        aria-label={t('admin.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {rows.length > 0 && (
        <div className={s.list}>
          {rows.map((u) => {
            const seen = str(u.updatedAt) ?? str(u.createdAt);
            return (
              <button
                key={u.id}
                type="button"
                className={s.row}
                onClick={() => push({ kind: 'adminUser', props: { id: u.id } })}
              >
                <Avatar userId={u.id} name={u.firstName} photoUrl={str(u.photoUrl)} />
                <div className={s.who}>
                  <b>
                    <span>{u.firstName}</span>
                    {u.isAdmin && <i className={`${s.tag} ${s.accent}`}>{t('admin.adminChip')}</i>}
                    {u.blockedAt && (
                      <i className={`${s.tag} ${s.danger}`}>{t('admin.blockedChip')}</i>
                    )}
                  </b>
                  <span>
                    {u.username ? `@${u.username} · ` : ''}
                    {u.id}
                  </span>
                </div>
                {seen && <div className={s.side}>{day(seen)}</div>}
              </button>
            );
          })}
        </div>
      )}

      {users.hasNextPage && (
        <button
          type="button"
          className={s.topBtn}
          disabled={users.isFetchingNextPage}
          onClick={() => void users.fetchNextPage()}
        >
          {t('common.more')}
        </button>
      )}
      {users.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {users.isSuccess && rows.length === 0 && <p className={s.status}>{t('admin.noUsers')}</p>}
      {users.isError && (
        <p className={s.error} role="alert">
          {errorMessage(users.error)}
        </p>
      )}
    </Sheet>
  );
}
