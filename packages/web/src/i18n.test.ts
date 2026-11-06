import { afterEach, describe, expect, it } from 'vitest';
import { installFakeWebApp } from '@dmytro-rudenko/tma-testing/dom';
import { createI18n } from '@dmytro-rudenko/tma-web';

const USER_UK = encodeURIComponent(JSON.stringify({ id: 42, first_name: 'Olia', language_code: 'uk' }));
const USER_DE = encodeURIComponent(JSON.stringify({ id: 42, first_name: 'Olia', language_code: 'de' }));

function make() {
  return createI18n({
    resources: { en: { translation: { hi: 'Hi' } }, uk: { translation: { hi: 'Привіт' } } },
    supported: ['uk', 'en'],
    fallback: 'en',
  });
}

afterEach(() => {
  delete (window as any).Telegram;
  document.documentElement.removeAttribute('lang');
});

describe('langFromCode', () => {
  it("returns 'uk' only for exactly 'uk'", () => {
    const { langFromCode } = make();
    expect(langFromCode('uk')).toBe('uk');
    expect(langFromCode('UK')).toBe('en');
    expect(langFromCode('uk-UA')).toBe('en');
    expect(langFromCode(' uk')).toBe('en');
    expect(langFromCode('ua')).toBe('en');
    expect(langFromCode('be')).toBe('en');
    expect(langFromCode(null)).toBe('en');
  });
});

describe('createI18n', () => {
  it('starts in the Telegram user language', () => {
    installFakeWebApp(window, { initData: `user=${USER_UK}&auth_date=1700000000&hash=abc` });
    const { i18n } = make();
    expect(i18n.language).toBe('uk');
    expect(i18n.t('hi')).toBe('Привіт');
  });

  it('setLanguage switches language and <html lang> through langFromCode', async () => {
    const { i18n, setLanguage } = make();
    setLanguage('uk');
    await expect.poll(() => i18n.language).toBe('uk');
    expect(document.documentElement.lang).toBe('uk');
    expect(i18n.t('hi')).toBe('Привіт');

    setLanguage('ru');
    await expect.poll(() => i18n.language).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18n.t('hi')).toBe('Hi');
  });

  it('applyLanguagePref: saved language wins, null follows Telegram', async () => {
    installFakeWebApp(window, { initData: `user=${USER_DE}&auth_date=1700000000&hash=abc` });
    const { i18n, applyLanguagePref } = make();
    applyLanguagePref('uk');
    await expect.poll(() => i18n.language).toBe('uk');

    applyLanguagePref(null);
    await expect.poll(() => i18n.language).toBe('en');

    installFakeWebApp(window, { initData: `user=${USER_UK}&auth_date=1700000000&hash=abc` });
    applyLanguagePref('en');
    await expect.poll(() => i18n.language).toBe('en');
    applyLanguagePref(null);
    await expect.poll(() => i18n.language).toBe('uk');
  });

  it('returns independent instances', async () => {
    const a = make();
    const b = make();
    a.setLanguage('en');
    b.setLanguage('uk');
    await expect.poll(() => b.i18n.language).toBe('uk');
    expect(a.i18n).not.toBe(b.i18n);
    expect(a.i18n.language).toBe('en');
  });
});
