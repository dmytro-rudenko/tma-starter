import { tg, type BroadcastAudience, type Lang } from '@dmytro-rudenko/tma-web';
import { useProducts, useTma } from '@dmytro-rudenko/tma-web/react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminKeys, useAudienceFilters, useBroadcastEstimate } from '../../api/adminHooks';
import { useErrorMessage } from '../../api/errorText';
import { Sheet } from '../../components/sheet/Sheet';
import { toast } from '../../components/Toast';
import { useDebounced } from '../../components/useDebounced';
import { pop, replaceTop } from '../../state/stack';
import s from './Admin.module.css';
import { AdminConfirm } from './AdminConfirm';

const ESTIMATE_DEBOUNCE_MS = 500;
const TEXT_MAX = 4096;
const LANGS: readonly Lang[] = ['uk', 'en'];

export function AdminBroadcastNewSheet() {
  const { t } = useTranslation();
  const { api } = useTma();
  const qc = useQueryClient();
  const errorMessage = useErrorMessage();
  const products = useProducts();
  const filters = useAudienceFilters();
  const [text, setText] = useState('');
  const [buttonText, setButtonText] = useState('');
  const [startParam, setStartParam] = useState('');
  const [langs, setLangs] = useState<readonly Lang[]>(LANGS);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [productId, setProductId] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const picked = Object.entries(enabled)
    .filter(([, on]) => on)
    .map(([key]) => [key, key === 'entitlement' ? productId : true] as const);
  const draftAudience: BroadcastAudience = {
    ...(langs.length === LANGS.length ? {} : { languages: [...langs] }),
    ...(picked.length > 0 ? { filters: Object.fromEntries(picked) } : {}),
  };
  const audienceKey = JSON.stringify(draftAudience);
  const settledKey = useDebounced(audienceKey, ESTIMATE_DEBOUNCE_MS);
  const audience = useMemo(() => JSON.parse(settledKey) as BroadcastAudience, [settledKey]);

  const filtersValid = !enabled.entitlement || productId !== '';
  const audienceValid = langs.length > 0 && filtersValid;
  const settled = settledKey === audienceKey;
  const estimate = useBroadcastEstimate(audience, audienceValid && settled);
  const total = estimate.data?.total;

  const trimmedButton = buttonText.trim();
  const payload = {
    text,
    ...(trimmedButton
      ? { button: { text: trimmedButton, ...(startParam ? { startParam } : {}) } }
      : {}),
  };
  const canSend = text.trim() !== '' && audienceValid && settled && !!total;

  const toggleLang = (lang: Lang) =>
    setLangs((cur) => (cur.includes(lang) ? cur.filter((l) => l !== lang) : [...cur, lang]));

  const preview = async () => {
    setBusy(true);
    try {
      await api.admin.broadcasts.preview(payload);
      tg.haptic.notify('success');
      toast(t('admin.previewSent'));
    } catch (e) {
      tg.haptic.notify('error');
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const created = await api.admin.broadcasts.create({ ...payload, audience });
      void qc.invalidateQueries({ queryKey: adminKeys.broadcasts });
      tg.haptic.notify('success');
      replaceTop({ kind: 'adminBroadcast', props: { id: created.id } });
    } catch (e) {
      tg.haptic.notify('error');
      toast(errorMessage(e));
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <Sheet open onClose={pop} title={t('admin.broadcastNewTitle')}>
      <p className={s.label}>{t('admin.broadcastText')}</p>
      <textarea
        className={`${s.field} ${s.json}`}
        rows={6}
        maxLength={TEXT_MAX}
        placeholder={t('admin.broadcastTextHint')}
        aria-label={t('admin.broadcastText')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <p className={s.label}>{t('admin.broadcastButtonLabel')}</p>
      <input
        className={s.field}
        type="text"
        placeholder={t('admin.broadcastButtonText')}
        aria-label={t('admin.broadcastButtonText')}
        value={buttonText}
        onChange={(e) => setButtonText(e.target.value)}
      />
      {trimmedButton && (
        <input
          className={`${s.field} ${s.gap}`}
          type="text"
          maxLength={64}
          placeholder={t('admin.broadcastStartParam')}
          aria-label={t('admin.broadcastStartParam')}
          value={startParam}
          onChange={(e) => setStartParam(e.target.value)}
        />
      )}

      <p className={s.label}>{t('admin.audience')}</p>
      {LANGS.map((lang) => (
        <label key={lang} className={s.check}>
          <input type="checkbox" checked={langs.includes(lang)} onChange={() => toggleLang(lang)} />
          {t(`admin.lang.${lang}`)}
        </label>
      ))}
      {filters.data?.map((f) => (
        <div key={f.key}>
          <label className={s.check}>
            <input
              type="checkbox"
              checked={!!enabled[f.key]}
              onChange={(e) => setEnabled((cur) => ({ ...cur, [f.key]: e.target.checked }))}
            />
            {t(`admin.filters.${f.key}`, { defaultValue: f.label })}
          </label>
          {f.key === 'entitlement' && enabled[f.key] && (
            <select
              className={`${s.field} ${s.gap}`}
              aria-label={t('admin.grantProduct')}
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{t('admin.chooseProduct')}</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}

      <p className={s.recipients} aria-live="polite">
        {audienceValid && settled && total !== undefined
          ? t('admin.recipients', { count: total })
          : t('admin.recipientsPending')}
      </p>

      {asking ? (
        <AdminConfirm
          text={t('admin.broadcastSendConfirm', { count: total ?? 0 })}
          yes={t('admin.broadcastSend')}
          pending={busy}
          onCancel={() => setAsking(false)}
          onYes={() => void send()}
        />
      ) : (
        <div className={s.actions}>
          <button
            type="button"
            className={s.act}
            disabled={busy || text.trim() === ''}
            onClick={() => void preview()}
          >
            {t('admin.broadcastPreview')}
          </button>
          <button
            type="button"
            className={`${s.act} ${s.primary}`}
            disabled={busy || !canSend}
            onClick={() => setAsking(true)}
          >
            {t('admin.broadcastSend')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
