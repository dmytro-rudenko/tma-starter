import { describe, expect, it } from 'vitest';
import en from './en.json';
import { i18n } from './index';
import uk from './uk.json';

type Dict = Record<string, unknown>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function leaves(obj: Dict, prefix = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? leaves(v as Dict, path) : [[path, v]];
  });
}

function baseKeys(obj: Dict): string[] {
  return [...new Set(leaves(obj).map(([k]) => k.replace(PLURAL_SUFFIX, '')))].sort();
}

const shop = import.meta.glob<{ default: Dict }>('./shop.*.json', { eager: true });

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('i18n dictionaries', () => {
  it('uk.json is not empty', () => {
    expect(baseKeys(uk as Dict).length).toBeGreaterThan(0);
  });

  it('uk.json and en.json have the same keys (plural suffixes folded)', () => {
    expect(baseKeys(uk as Dict)).toEqual(baseKeys(en as Dict));
  });

  it.each([
    ['uk', uk],
    ['en', en],
  ] as const)('every value in %s.json is a non-empty string', (_lang, dict) => {
    const bad = leaves(dict as Dict).filter(([, v]) => typeof v !== 'string' || v.trim() === '');
    expect(bad).toEqual([]);
  });

  it('shop.uk.json and shop.en.json come as a pair, hold only shop.* keys and match each other', () => {
    const files = Object.keys(shop).sort();
    if (files.length === 0) return;
    expect(files).toEqual(['./shop.en.json', './shop.uk.json']);
    const shopUk = shop['./shop.uk.json']!.default;
    const shopEn = shop['./shop.en.json']!.default;
    expect(baseKeys(shopUk)).toEqual(baseKeys(shopEn));
    expect(baseKeys(shopUk).filter((k) => !k.startsWith('shop.'))).toEqual([]);
    const bad = [...leaves(shopUk), ...leaves(shopEn)].filter(
      ([, v]) => typeof v !== 'string' || v.trim() === '',
    );
    expect(bad).toEqual([]);
  });

  it('the i18n instance serves the shop dictionaries next to the base ones', () => {
    const files = Object.keys(shop);
    for (const lang of ['uk', 'en'] as const) {
      const dict = shop[`./shop.${lang}.json`]?.default;
      if (!dict) {
        expect(files).toEqual([]);
        continue;
      }
      for (const [path, value] of leaves(dict)) {
        expect(i18n.getResource(lang, 'translation', path)).toBe(value);
      }
      expect(i18n.getResource(lang, 'translation', 'common.loading')).toBeTruthy();
    }
  });

  it.each(['uk', 'en'] as const)('every literal t() key in the sources exists in %s', (lang) => {
    const keys = Object.values(sources).flatMap((src) =>
      [...src.matchAll(/\bt\(\s*'([\w.]+)'/g)].map((m) => m[1]!),
    );
    expect(keys.length).toBeGreaterThan(0);
    const missing = [...new Set(keys)].filter((key) => !i18n.exists(key, { lng: lang, count: 1 }));
    expect(missing).toEqual([]);
  });
});
