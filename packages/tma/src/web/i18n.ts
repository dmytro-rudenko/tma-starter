import i18next, { type i18n as I18n, type Resource } from 'i18next';
import { tg } from './tg.js';

export type Lang = 'uk' | 'en';

export interface CreateI18nOptions<L extends string> {
  resources: Resource;
  supported: readonly L[];
  fallback: L;
}

export interface TmaI18n<L extends string = Lang> {
  i18n: I18n;
  setLanguage(code: string | null | undefined): void;
  applyLanguagePref(pref: L | null): void;
  langFromCode(code: string | null | undefined): L;
}

const registry = new WeakMap<I18n, TmaI18n<string>>();

export function i18nControls(i18n: I18n): TmaI18n<string> | undefined {
  return registry.get(i18n);
}

export function createI18n<L extends string = Lang>(opts: CreateI18nOptions<L>): TmaI18n<L> {
  const langFromCode = (code: string | null | undefined): L =>
    opts.supported.find((l) => l === code) ?? opts.fallback;
  const i18n = i18next.createInstance();
  void i18n.init({
    resources: opts.resources,
    lng: langFromCode(tg.languageCode()),
    fallbackLng: opts.fallback,
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
  const setLanguage = (code: string | null | undefined): void => {
    const lang = langFromCode(code);
    if (i18n.language !== lang) void i18n.changeLanguage(lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  };
  const applyLanguagePref = (pref: L | null): void => setLanguage(pref ?? tg.languageCode());
  const out: TmaI18n<L> = { i18n, setLanguage, applyLanguagePref, langFromCode };
  registry.set(i18n, out as unknown as TmaI18n<string>);
  return out;
}
