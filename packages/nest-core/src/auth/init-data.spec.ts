import { signInitData } from '@dmytro-rudenko/tma-testing';
import { validateInitData } from './init-data';

const BOT = '123:TEST';
const user = { id: 4242, first_name: 'Olena', username: 'olena', language_code: 'uk' };
const MAX_AGE = 86400;

describe('validateInitData', () => {
  it('returns the user for a correctly signed, fresh string', () => {
    expect(validateInitData(signInitData(user, BOT), BOT, MAX_AGE)).toEqual(user);
  });

  it('returns null when one char of the hash is changed', () => {
    const p = new URLSearchParams(signInitData(user, BOT));
    const h = p.get('hash')!;
    p.set('hash', (h[0] === 'a' ? 'b' : 'a') + h.slice(1));
    expect(validateInitData(p.toString(), BOT, MAX_AGE)).toBeNull();
  });

  it('returns null when a signed field is changed', () => {
    const p = new URLSearchParams(signInitData(user, BOT));
    p.set('user', JSON.stringify({ ...user, id: 1 }));
    expect(validateInitData(p.toString(), BOT, MAX_AGE)).toBeNull();
  });

  it('returns null when signed with another bot token', () => {
    expect(validateInitData(signInitData(user, '999:OTHER'), BOT, MAX_AGE)).toBeNull();
  });

  it('returns null when auth_date is older than maxAgeSec', () => {
    const raw = signInitData(user, BOT, { authDate: Math.floor(Date.now() / 1000) - MAX_AGE - 10 });
    expect(validateInitData(raw, BOT, MAX_AGE)).toBeNull();
  });

  it('returns the user when auth_date is inside maxAgeSec', () => {
    const raw = signInitData(user, BOT, { authDate: Math.floor(Date.now() / 1000) - MAX_AGE + 60 });
    expect(validateInitData(raw, BOT, MAX_AGE)).toEqual(user);
  });

  it('rejects auth_date more than 60 s in the future', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    expect(validateInitData(signInitData(user, BOT, { authDate: nowSec + 120 }), BOT, MAX_AGE)).toBeNull();
    expect(validateInitData(signInitData(user, BOT, { authDate: nowSec + 30 }), BOT, MAX_AGE)).toEqual(user);
  });

  it('returns null when hash is missing', () => {
    const p = new URLSearchParams(signInitData(user, BOT));
    p.delete('hash');
    expect(validateInitData(p.toString(), BOT, MAX_AGE)).toBeNull();
  });

  it('returns null for garbage input and a hash of the wrong length', () => {
    expect(validateInitData('', BOT, MAX_AGE)).toBeNull();
    const p = new URLSearchParams(signInitData(user, BOT));
    p.set('hash', 'abcd');
    expect(validateInitData(p.toString(), BOT, MAX_AGE)).toBeNull();
  });

  it('keeps start_param in the signed data', () => {
    const raw = signInitData(user, BOT, { startParam: 'inv_xyz' });
    expect(validateInitData(raw, BOT, MAX_AGE)).toEqual(user);
  });
});
