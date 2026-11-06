import type { Lang } from './i18n.js';
import { applyTheme, type ThemePref } from './theme.js';

export interface CachedPrefs {
  theme?: ThemePref;
  language?: Lang | null;
  [key: string]: unknown;
}

export interface PrefsCache {
  read(): CachedPrefs;
  write(p: CachedPrefs): void;
  restore(applyLanguagePref?: (pref: Lang | null) => void): void;
}

const THEMES: readonly unknown[] = ['system', 'light', 'dark'];
const LANGS: readonly unknown[] = ['uk', 'en', null];

export function createPrefsCache(key: string): PrefsCache {
  const read = (): CachedPrefs => {
    try {
      const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const { theme, language, ...rest } = raw as Record<string, unknown>;
      const out: CachedPrefs = { ...rest };
      if (THEMES.includes(theme)) out.theme = theme as ThemePref;
      if ('language' in raw && LANGS.includes(language)) out.language = language as Lang | null;
      return out;
    } catch {
      return {};
    }
  };
  return {
    read,
    write(p) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify({ ...read(), ...p }));
      } catch {
        return;
      }
    },
    restore(applyLanguagePref) {
      const p = read();
      if (p.language !== undefined) applyLanguagePref?.(p.language);
      if (p.theme) applyTheme(p.theme);
    },
  };
}
