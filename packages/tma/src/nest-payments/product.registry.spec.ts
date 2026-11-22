import { Product } from './product';
import { ProductRegistry } from './product.registry';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'premium',
    kind: 'one_time',
    priceStars: () => 50,
    title: (lang) => (lang === 'uk' ? 'Преміум' : 'Premium'),
    description: (lang) => (lang === 'uk' ? 'Преміум-доступ' : 'Premium access'),
    ...overrides,
  };
}

describe('ProductRegistry', () => {
  it('returns registered products by id in registration order', () => {
    const premium = product();
    const vip = product({ id: 'vip', kind: 'subscription' });
    const registry = new ProductRegistry([premium, vip]);
    expect(registry.get('premium')).toBe(premium);
    expect(registry.get('vip')).toBe(vip);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.ids()).toEqual(['premium', 'vip']);
  });

  it('accepts an empty product list', () => {
    expect(new ProductRegistry([]).ids()).toEqual([]);
  });

  it.each(['a', 'pack_10', '0', 'a'.repeat(24)])('accepts id %p', (id) => {
    expect(new ProductRegistry([product({ id })]).ids()).toEqual([id]);
  });

  it.each([
    '',
    'a'.repeat(25),
    'Premium',
    'pre-mium',
    'pre:mium',
    'pre mium',
    ' premium',
    'преміум',
  ])('rejects id %p', (id) => {
    expect(() => new ProductRegistry([product({ id })])).toThrow(Error);
  });

  it('names the offending id in the error', () => {
    expect(() => new ProductRegistry([product({ id: 'Bad-Id' })])).toThrow(/Bad-Id/);
  });

  it('rejects a duplicate id', () => {
    expect(
      () =>
        new ProductRegistry([product(), product({ id: 'vip' }), product({ kind: 'subscription' })]),
    ).toThrow(/premium/);
  });

  it.each(['one_time', 'subscription'] as const)('accepts kind %s', (kind) => {
    expect(new ProductRegistry([product({ kind })]).get('premium')!.kind).toBe(kind);
  });

  it('rejects an unknown kind', () => {
    expect(
      () => new ProductRegistry([product({ kind: 'lifetime' as unknown as Product['kind'] })]),
    ).toThrow(/premium/);
  });

  it('rejects lock without settle', () => {
    expect(() => new ProductRegistry([product({ lock: async () => null })])).toThrow(/premium/);
  });

  it('accepts lock together with settle', () => {
    const p = product({ lock: async () => ({}), settle: async () => undefined });
    expect(new ProductRegistry([p]).get('premium')).toBe(p);
  });

  it('accepts settle without lock', () => {
    expect(new ProductRegistry([product({ settle: async () => undefined })]).ids()).toEqual([
      'premium',
    ]);
  });

  it('accepts a title of 1 and of 32 characters', () => {
    expect(new ProductRegistry([product({ title: () => 'V' })]).ids()).toEqual(['premium']);
    expect(new ProductRegistry([product({ title: () => 'Ї'.repeat(32) })]).ids()).toEqual([
      'premium',
    ]);
  });

  it.each([
    ['empty in both languages', () => ''],
    ['33 characters in both languages', () => 'Ї'.repeat(33)],
    ['empty only in uk', (lang: 'uk' | 'en') => (lang === 'uk' ? '' : 'Premium')],
    ['empty only in en', (lang: 'uk' | 'en') => (lang === 'en' ? '' : 'Преміум')],
    [
      '33 characters only in uk',
      (lang: 'uk' | 'en') => (lang === 'uk' ? 'Ї'.repeat(33) : 'Premium'),
    ],
    [
      '33 characters only in en',
      (lang: 'uk' | 'en') => (lang === 'en' ? 'a'.repeat(33) : 'Преміум'),
    ],
  ])('rejects a title %s', (_name, title) => {
    expect(() => new ProductRegistry([product({ title })])).toThrow(/premium/);
  });

  it('accepts a description of 1 and of 255 characters', () => {
    expect(new ProductRegistry([product({ description: () => 'd' })]).ids()).toEqual(['premium']);
    expect(new ProductRegistry([product({ description: () => 'Ї'.repeat(255) })]).ids()).toEqual([
      'premium',
    ]);
  });

  it.each([
    ['empty in both languages', () => ''],
    ['256 characters in both languages', () => 'Ї'.repeat(256)],
    ['empty only in uk', (lang: 'uk' | 'en') => (lang === 'uk' ? '' : 'Premium access')],
    ['empty only in en', (lang: 'uk' | 'en') => (lang === 'en' ? '' : 'Преміум-доступ')],
    [
      '256 characters only in uk',
      (lang: 'uk' | 'en') => (lang === 'uk' ? 'Ї'.repeat(256) : 'Premium access'),
    ],
    [
      '256 characters only in en',
      (lang: 'uk' | 'en') => (lang === 'en' ? 'a'.repeat(256) : 'Преміум-доступ'),
    ],
  ])('rejects a description %s', (_name, description) => {
    expect(() => new ProductRegistry([product({ description })])).toThrow(/premium/);
  });
});
