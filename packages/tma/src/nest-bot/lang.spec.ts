import { escapeHtml, langOf } from './lang';

describe('langOf', () => {
  it('returns uk only for exactly "uk"', () => {
    expect(langOf('uk')).toBe('uk');
  });

  it.each([['en'], ['ru'], ['de'], ['UK'], ['uk-UA'], [' uk'], ['']])('"%s" → en', (code) => {
    expect(langOf(code)).toBe('en');
  });

  it('null and undefined → en', () => {
    expect(langOf(null)).toBe('en');
    expect(langOf(undefined)).toBe('en');
  });
});

describe('escapeHtml', () => {
  it('escapes &, < and > for parse_mode HTML', () => {
    expect(escapeHtml('<b>Tom & Jerry</b>')).toBe('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;');
  });

  it('escapes & before the entities it produces', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('a<&>b')).toBe('a&lt;&amp;&gt;b');
  });

  it('leaves quotes and plain text untouched', () => {
    expect(escapeHtml(`"Ім'я" 'x'`)).toBe(`"Ім'я" 'x'`);
    expect(escapeHtml('')).toBe('');
  });
});
