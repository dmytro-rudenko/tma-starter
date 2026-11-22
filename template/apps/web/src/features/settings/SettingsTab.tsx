import type { Lang, ThemePref, UpdateMeDto } from '@pctea/tma-web';
import { useMe, useTma, useUpdateMe } from '@pctea/tma-web/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useErrorMessage } from '../../api/errorText';
import { toast } from '../../components/Toast';
import { push, type EntryKind } from '../../state/stack';
// tma:shop:start
import { SubscriptionSection } from '../shop/SubscriptionSection';
// tma:shop:end
import s from './SettingsTab.module.css';

const LANGS: readonly { value: Lang; label: string }[] = [
  { value: 'uk', label: 'Українська' },
  { value: 'en', label: 'English' },
];

const THEMES: readonly { value: ThemePref; key: string }[] = [
  { value: 'system', key: 'settings.themeSystem' },
  { value: 'light', key: 'settings.themeLight' },
  { value: 'dark', key: 'settings.themeDark' },
];

const ADMIN_ITEMS: readonly { kind: EntryKind; key: string }[] = [
  { kind: 'adminUsers', key: 'settings.users' },
  { kind: 'adminSettings', key: 'settings.appSettings' },
  { kind: 'adminBroadcasts', key: 'settings.broadcasts' },
  { kind: 'adminPayments', key: 'settings.payments' },
  { kind: 'adminAudit', key: 'settings.audit' },
];

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <section className={s.sec}>
      <h3 id={id}>{label}</h3>
      <div className={s.seg} role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => value !== o.value && onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function AdminSection() {
  const { t } = useTranslation();
  return (
    <section className={s.sec}>
      <h3>{t('settings.admin')}</h3>
      <div className={s.list}>
        {ADMIN_ITEMS.map(({ kind, key }) => (
          <button
            key={kind}
            type="button"
            className={s.row}
            onClick={() => push({ kind, props: {} })}
          >
            {t(key)}
            <span className={s.chev} aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function SettingsTab() {
  const { t, i18n } = useTranslation();
  const me = useMe();
  const update = useUpdateMe();
  const { applyPrefs } = useTma();
  const errorMessage = useErrorMessage();
  const lang: Lang = me.data?.language ?? (i18n.language === 'uk' ? 'uk' : 'en');
  const theme: ThemePref = me.data?.theme ?? 'system';

  const save = (next: UpdateMeDto, previous: UpdateMeDto) => {
    applyPrefs(next);
    update.mutate(next, {
      onError: (e) => {
        applyPrefs(previous);
        toast(errorMessage(e));
      },
    });
  };

  return (
    <>
      <div className={s.largeTitle}>
        <h1>{t('settings.title')}</h1>
      </div>

      <Segment
        label={t('settings.language')}
        options={LANGS}
        value={lang}
        onChange={(language) => save({ language }, { language: me.data?.language ?? null })}
      />

      <Segment
        label={t('settings.theme')}
        options={THEMES.map((o) => ({ value: o.value, label: t(o.key) }))}
        value={theme}
        onChange={(next) => save({ theme: next }, { theme })}
      />

      {/* tma:shop:start */}
      <SubscriptionSection />
      {/* tma:shop:end */}

      {me.data?.isAdmin && <AdminSection />}
    </>
  );
}
