import { makePayload, parsePayload } from './invoice-payload';

const IDS = ['premium', 'vip', 'pack_10'] as const;
const TARGET = '6f1c2b8e-3a4d-4e5f-9a0b-1c2d3e4f5a6b';
const NONCE = 'AAAAAAAAAAA';
const NONCE_RE = /^[A-Za-z0-9_-]{11}$/;

describe('invoice payload', () => {
  it('writes "-" for a missing target and an 8-byte base64url nonce', () => {
    const payload = makePayload('premium');
    expect(payload).toMatch(/^premium:-:[A-Za-z0-9_-]{11}$/);
    const nonce = payload.split(':')[2];
    expect(Buffer.from(nonce, 'base64url')).toHaveLength(8);
  });

  it('puts the target between the product id and the nonce', () => {
    expect(makePayload('vip', TARGET).startsWith(`vip:${TARGET}:`)).toBe(true);
  });

  it('gives a fresh nonce on every call', () => {
    expect(makePayload('premium', TARGET)).not.toBe(makePayload('premium', TARGET));
  });

  it('round-trips a payload without a target', () => {
    const parsed = parsePayload(makePayload('premium'), IDS);
    expect(parsed).toEqual({ productId: 'premium', nonce: expect.stringMatching(NONCE_RE) });
    expect(parsed!.targetId).toBeUndefined();
  });

  it.each(IDS)('round-trips product %s with a target', (productId) => {
    expect(parsePayload(makePayload(productId, TARGET), IDS)).toEqual({
      productId,
      targetId: TARGET,
      nonce: expect.stringMatching(NONCE_RE),
    });
  });

  it('parses a numeric target', () => {
    expect(parsePayload(`pack_10:42:${NONCE}`, IDS)).toEqual({
      productId: 'pack_10',
      targetId: '42',
      nonce: NONCE,
    });
  });

  it('accepts a payload of exactly 128 bytes', () => {
    const target = 'a'.repeat(108);
    const payload = makePayload('premium', target);
    expect(Buffer.byteLength(payload)).toBe(128);
    expect(parsePayload(payload, IDS)).toEqual({
      productId: 'premium',
      targetId: target,
      nonce: expect.stringMatching(NONCE_RE),
    });
  });

  it('refuses to make a payload longer than 128 bytes', () => {
    expect(() => makePayload('premium', 'a'.repeat(109))).toThrow();
  });

  it('counts the limit in bytes, not characters', () => {
    expect(() => makePayload('premium', 'ї'.repeat(60))).toThrow();
  });

  it.each([':', 'a:b', '-'])('refuses target %p that would break the format', (target) => {
    expect(() => makePayload('premium', target)).toThrow();
  });

  it.each([
    '',
    'garbage',
    'premium',
    'premium:-',
    `premium:-:${NONCE}:extra`,
    `premium::${NONCE}`,
    `prem:-:${NONCE}`,
    `premium_x:-:${NONCE}`,
    `PREMIUM:-:${NONCE}`,
    `unknown:-:${NONCE}`,
    'premium:-:garbage-payload-xx',
    'premium:-:missingNonce',
    'premium:-:bad nonce!!',
    `premium:${'a'.repeat(109)}:${NONCE}`,
  ])('garbage %p → null', (s) => {
    expect(parsePayload(s, IDS)).toBeNull();
  });

  it('only accepts ids passed in', () => {
    const payload = makePayload('vip');
    expect(parsePayload(payload, ['premium'])).toBeNull();
    expect(parsePayload(payload, ['premium', 'vip'])).toEqual({
      productId: 'vip',
      nonce: expect.stringMatching(NONCE_RE),
    });
  });
});
