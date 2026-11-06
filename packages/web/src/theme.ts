import { tg, type ColorScheme } from './tg.js';

export type ThemePref = 'system' | 'light' | 'dark';

let current: ThemePref = 'system';

export function applyTheme(pref: ThemePref): void {
  current = pref;
  const scheme: ColorScheme = pref === 'system' ? tg.colorScheme() : pref;
  document.documentElement.dataset.theme = scheme;
  tg.applyChrome(scheme);
}

export function watchSystemTheme(): () => void {
  const onChange = () => {
    if (current === 'system') applyTheme('system');
  };
  const offTg = tg.onThemeChanged(onChange);
  let offMedia = () => {};
  try {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (mq?.addEventListener) {
      mq.addEventListener('change', onChange);
      offMedia = () => mq.removeEventListener('change', onChange);
    }
  } catch {
    offMedia = () => {};
  }
  return () => {
    offTg();
    offMedia();
  };
}

export function applyThemeParams(): () => void {
  const apply = () => {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(tg.themeParams())) {
      style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
    }
  };
  apply();
  return tg.onThemeChanged(apply);
}
