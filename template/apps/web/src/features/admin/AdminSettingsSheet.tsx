import { ApiError, tg, type AdminSetting } from 'tma-starter/web';
import { useTma } from 'tma-starter/web/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminKeys, useAdminSettings } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { pop } from '../../state/stack';
import s from './Admin.module.css';

type Kind = 'boolean' | 'number' | 'string' | 'ids' | 'json';

const kindOf = (def: unknown): Kind => {
  if (typeof def === 'boolean') return 'boolean';
  if (typeof def === 'number') return 'number';
  if (typeof def === 'string') return 'string';
  if (Array.isArray(def) && def.every((n) => typeof n === 'number')) return 'ids';
  return 'json';
};

const toDraft = (kind: Kind, value: unknown): string | boolean => {
  switch (kind) {
    case 'boolean':
      return value === true;
    case 'number':
      return String(value ?? '');
    case 'string':
      return typeof value === 'string' ? value : '';
    case 'ids':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'json':
      return JSON.stringify(value, null, 2) ?? '';
  }
};

const invalid = () => new ApiError(400, 'VALIDATION', 'invalid input');

const fromDraft = (kind: Kind, draft: string | boolean): unknown => {
  if (kind === 'boolean') return draft === true;
  const text = String(draft);
  if (kind === 'string') return text;
  if (kind === 'number') {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) throw invalid();
    return n;
  }
  if (kind === 'ids') {
    const ids = text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map(Number);
    if (ids.some((n) => !Number.isFinite(n))) throw invalid();
    return ids;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw invalid();
  }
};

function SettingRow({ setting }: { setting: AdminSetting }) {
  const { t } = useTranslation();
  const { api } = useTma();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const labelId = useId();
  const kind = kindOf(setting.default);
  const saved = toDraft(kind, setting.value);
  const [draft, setDraft] = useState<string | boolean>(saved);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (value: unknown) => api.admin.settings.set(setting.key, value),
    onSuccess: (list) => {
      qc.setQueryData(adminKeys.settings, list);
      const next = list.find((x) => x.key === setting.key);
      if (next) setDraft(toDraft(kind, next.value));
      setError(null);
      tg.haptic.notify('success');
      toast(t('admin.saved'));
    },
    onError: (e) => {
      tg.haptic.notify('error');
      setError(errorMessage(e));
    },
  });

  const submit = () => {
    setError(null);
    try {
      save.mutate(fromDraft(kind, draft));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const text = typeof draft === 'string' ? draft : '';

  return (
    <div className={s.setting} role="group" aria-labelledby={labelId}>
      <code id={labelId} className={s.settingKey}>
        {setting.key}
      </code>
      <div className={s.settingBody}>
        {kind === 'boolean' && (
          <button
            type="button"
            role="switch"
            aria-checked={draft === true}
            aria-labelledby={labelId}
            className={s.switch}
            onClick={() => setDraft(draft !== true)}
          />
        )}
        {kind === 'number' && (
          <input
            className={s.field}
            type="number"
            inputMode="decimal"
            aria-labelledby={labelId}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        {kind === 'string' && (
          <input
            className={s.field}
            type="text"
            aria-labelledby={labelId}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        {kind === 'ids' && (
          <input
            className={s.field}
            type="text"
            placeholder={t('admin.idsPlaceholder')}
            aria-labelledby={labelId}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        {kind === 'json' && (
          <textarea
            className={`${s.field} ${s.json}`}
            rows={6}
            spellCheck={false}
            aria-labelledby={labelId}
            value={text}
            onChange={(e) => setDraft(e.target.value)}
          />
        )}
        <button
          type="button"
          className={s.act}
          disabled={draft === saved || save.isPending}
          onClick={submit}
        >
          {t('common.save')}
        </button>
      </div>
      <p className={s.hintLine}>
        {t('admin.settingDefault', { value: JSON.stringify(setting.default) })}
      </p>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AdminSettingsSheet() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const settings = useAdminSettings();

  return (
    <Sheet open onClose={pop} title={t('admin.settingsTitle')}>
      {settings.data?.map((setting) => (
        <SettingRow key={setting.key} setting={setting} />
      ))}
      {settings.isLoading && <p className={s.status}>{t('common.loading')}</p>}
      {settings.isError && (
        <p className={s.error} role="alert">
          {errorMessage(settings.error)}
        </p>
      )}
    </Sheet>
  );
}
