import { tg, type EntitlementDto, type PaymentDto } from '@dmytro-rudenko/tma-web';
import { tmaKeys, useProducts, useTma } from '@dmytro-rudenko/tma-web/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminRefresh, useAdminUser } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { Avatar } from '../../components/Avatar';
import { day, str } from '../../components/format';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { getStack, pop } from '../../state/stack';
import s from './Admin.module.css';
import { AdminConfirm } from './AdminConfirm';

interface BotCard {
  botBlockedAt: string | null;
}

interface PaymentsCard {
  payments: PaymentDto[];
  entitlements: EntitlementDto[];
}

const closeAdminSheets = () => {
  for (let st = getStack(); st[st.length - 1]?.kind.startsWith('admin'); st = getStack()) pop();
};

const isActive = (e: EntitlementDto) =>
  !e.expiresAt || new Date(e.expiresAt).getTime() > Date.now();

function useAction() {
  const refresh = useAdminRefresh();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      tg.haptic.notify('success');
      toast(done);
      return true;
    } catch (e) {
      tg.haptic.notify('error');
      toast(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return { busy, run };
}

export function AdminUserSheet({ id }: { id: number }) {
  const { t } = useTranslation();
  const { api } = useTma();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const user = useAdminUser(id);
  const { busy, run } = useAction();
  const [asking, setAsking] = useState<'block' | 'grant' | 'revoke' | null>(null);
  const u = user.data;

  const confirmed = (fn: () => Promise<unknown>, done: string) =>
    void run(fn, done).then((ok) => ok && setAsking(null));

  const runRights = (fn: () => Promise<unknown>, done: string) =>
    confirmed(async () => {
      await fn();
      const me = await qc.fetchQuery({
        queryKey: tmaKeys.me,
        queryFn: () => api.me(),
        staleTime: 0,
      });
      if (!me.isAdmin) closeAdminSheets();
    }, done);

  const bot = u?.cards.bot as BotCard | undefined;
  const payments = u?.cards.payments as PaymentsCard | undefined;
  const joined = u ? str(u.createdAt) : null;
  const seen = u ? str(u.updatedAt) : null;

  return (
    <Sheet open onClose={pop} title={u?.firstName ?? t('admin.usersTitle')}>
      {u && (
        <>
          <div className={s.head}>
            <Avatar userId={u.id} name={u.firstName} photoUrl={str(u.photoUrl)} size={56} />
            <div>
              <h2>
                {u.firstName}
                {u.isAdmin && <i className={`${s.tag} ${s.accent}`}>{t('admin.adminChip')}</i>}
                {u.blockedAt && <i className={`${s.tag} ${s.danger}`}>{t('admin.blockedChip')}</i>}
              </h2>
              <div className={s.meta}>
                {u.username ? `@${u.username} · ` : ''}ID {u.id}
              </div>
              {(joined || seen) && (
                <div className={s.meta}>
                  {joined && t('admin.joined', { date: day(joined) })}
                  {joined && seen && ' · '}
                  {seen && t('admin.seen', { date: day(seen) })}
                </div>
              )}
            </div>
          </div>

          <div className={s.actions}>
            {u.blockedAt ? (
              <button
                type="button"
                className={s.act}
                disabled={busy}
                onClick={() => void run(() => api.admin.users.unblock(u.id), t('admin.unblocked'))}
              >
                {t('admin.unblock')}
              </button>
            ) : (
              <button
                type="button"
                className={`${s.act} ${s.danger}`}
                disabled={u.isAdmin}
                onClick={() => setAsking('block')}
              >
                {t('admin.block')}
              </button>
            )}
            {!u.blockedAt && u.adminSource === null && (
              <button
                type="button"
                className={s.act}
                disabled={busy}
                onClick={() => setAsking('grant')}
              >
                {t('admin.grantAdmin')}
              </button>
            )}
            {u.adminSource === 'granted' && (
              <button
                type="button"
                className={`${s.act} ${s.danger}`}
                disabled={busy}
                onClick={() => setAsking('revoke')}
              >
                {t('admin.revokeAdmin')}
              </button>
            )}
          </div>
          {asking === 'block' && (
            <AdminConfirm
              danger
              text={t('admin.blockConfirm', { name: u.firstName })}
              yes={t('admin.block')}
              pending={busy}
              onCancel={() => setAsking(null)}
              onYes={() => confirmed(() => api.admin.users.block(u.id), t('admin.blocked'))}
            />
          )}
          {asking === 'grant' && (
            <AdminConfirm
              text={t('admin.grantConfirm', { name: u.firstName })}
              yes={t('admin.grantAdmin')}
              pending={busy}
              onCancel={() => setAsking(null)}
              onYes={() => runRights(() => api.admin.users.grant(u.id), t('admin.granted'))}
            />
          )}
          {asking === 'revoke' && (
            <AdminConfirm
              danger
              text={t('admin.revokeConfirm', { name: u.firstName })}
              yes={t('admin.revokeAdmin')}
              pending={busy}
              onCancel={() => setAsking(null)}
              onYes={() => runRights(() => api.admin.users.revoke(u.id), t('admin.revoked'))}
            />
          )}

          {bot && <BotBlock card={bot} />}
          {payments && <PaymentsBlock payments={payments.payments} />}
          {payments && <AccessBlock userId={u.id} entitlements={payments.entitlements} />}
        </>
      )}
      {user.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {user.isError && (
        <p className={s.error} role="alert">
          {errorMessage(user.error)}
        </p>
      )}
    </Sheet>
  );
}

function BotBlock({ card }: { card: BotCard }) {
  const { t } = useTranslation();
  return (
    <section className={s.block}>
      <h3>{t('admin.bot')}</h3>
      <p className={s.line}>
        {card.botBlockedAt
          ? t('admin.botBlocked', { date: day(card.botBlockedAt) })
          : t('admin.botReachable')}
      </p>
    </section>
  );
}

function PaymentsBlock({ payments }: { payments: PaymentDto[] }) {
  const { t } = useTranslation();
  const { api } = useTma();
  const { busy, run } = useAction();
  const [asking, setAsking] = useState<PaymentDto | null>(null);

  return (
    <section className={s.block}>
      <h3>{t('admin.payments')}</h3>
      {payments.length === 0 ? (
        <p className={s.status}>{t('admin.noPayments')}</p>
      ) : (
        <ul className={`${s.list} ${s.flat}`}>
          {payments.map((p) => (
            <li key={p.id} className={s.row}>
              <div className={s.who}>
                <b>
                  <span>
                    {p.productId} · {t('common.stars', { count: p.amountStars })}
                  </span>
                </b>
                <span>
                  {day(p.createdAt)} · {t(`admin.payStatus.${p.status}`)}
                </span>
              </div>
              {p.status === 'paid' && (
                <button
                  type="button"
                  className={s.rowAction}
                  disabled={busy}
                  onClick={() => setAsking(p)}
                >
                  {t('admin.refund')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <AdminConfirm
          danger
          text={t('admin.refundConfirm', { count: asking.amountStars })}
          yes={t('admin.refund')}
          pending={busy}
          onCancel={() => setAsking(null)}
          onYes={() =>
            void run(() => api.admin.payments.refund(asking.id), t('admin.refunded')).then(
              (ok) => ok && setAsking(null),
            )
          }
        />
      )}
    </section>
  );
}

function AccessBlock({ userId, entitlements }: { userId: number; entitlements: EntitlementDto[] }) {
  const { t } = useTranslation();
  const { api } = useTma();
  const products = useProducts();
  const { busy, run } = useAction();
  const [asking, setAsking] = useState<EntitlementDto | null>(null);
  const [productId, setProductId] = useState('');
  const [until, setUntil] = useState('');
  const active = entitlements.filter(isActive);
  const title = (id: string) => products.data?.find((p) => p.id === id)?.title ?? id;

  const grant = (e: FormEvent) => {
    e.preventDefault();
    const expiresAt = until ? new Date(`${until}T23:59:59`).toISOString() : undefined;
    void run(
      () =>
        api.admin.entitlements.grant(userId, { productId, ...(expiresAt ? { expiresAt } : {}) }),
      t('admin.accessGranted'),
    ).then((ok) => {
      if (!ok) return;
      setProductId('');
      setUntil('');
    });
  };

  return (
    <section className={s.block}>
      <h3>{t('admin.access')}</h3>
      {active.length === 0 ? (
        <p className={s.status}>{t('admin.noAccess')}</p>
      ) : (
        <ul className={`${s.list} ${s.flat}`}>
          {active.map((e) => (
            <li key={e.productId} className={s.row}>
              <div className={s.who}>
                <b>
                  <span>{title(e.productId)}</span>
                  {e.canceled && <i className={s.tag}>{t('admin.canceled')}</i>}
                </b>
                <span>
                  {t(`admin.source.${e.source}`)}
                  {e.expiresAt ? ` · ${t('admin.until', { date: day(e.expiresAt) })}` : ''}
                </span>
              </div>
              <button
                type="button"
                className={s.rowAction}
                disabled={busy}
                onClick={() => setAsking(e)}
              >
                {t('admin.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <AdminConfirm
          danger
          text={t('admin.revokeAccessConfirm', { product: title(asking.productId) })}
          yes={t('admin.revoke')}
          pending={busy}
          onCancel={() => setAsking(null)}
          onYes={() =>
            void run(
              () => api.admin.entitlements.revoke(userId, asking.productId),
              t('admin.accessRevoked'),
            ).then((ok) => ok && setAsking(null))
          }
        />
      )}
      {products.data && products.data.length > 0 && (
        <form className={s.grant} onSubmit={grant}>
          <p className={s.label}>{t('admin.grantAccess')}</p>
          <select
            className={s.field}
            aria-label={t('admin.grantProduct')}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">{t('admin.chooseProduct')}</option>
            {products.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <input
            className={s.field}
            type="date"
            aria-label={t('admin.grantUntil')}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          <button type="submit" className={s.act} disabled={busy || !productId}>
            {t('admin.grant')}
          </button>
        </form>
      )}
    </section>
  );
}
