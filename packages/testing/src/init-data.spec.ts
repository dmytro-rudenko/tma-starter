import { createHmac } from 'crypto';
import { signInitData, tmaAuth } from './init-data';

const BOT_TOKEN = '123456:INIT-DATA-SPEC';
const USER = { id: 42, first_name: 'Olia', username: 'olia', language_code: 'uk' };

function expectedHash(data: URLSearchParams, botToken: string): string {
  const checkString = [...data.entries()]
    .filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

describe('signInitData', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('signs the fields with HMAC-SHA256 keyed by HMAC("WebAppData", botToken)', () => {
    const data = new URLSearchParams(signInitData(USER, BOT_TOKEN));

    const hash = data.get('hash');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(expectedHash(data, BOT_TOKEN));
    expect(expectedHash(data, '999999:OTHER')).not.toBe(hash);
  });

  it('serialises the user as JSON in the user field', () => {
    const data = new URLSearchParams(signInitData(USER, BOT_TOKEN));

    expect(JSON.parse(data.get('user')!)).toEqual(USER);
  });

  it('uses the current time in seconds as auth_date by default', () => {
    jest.useFakeTimers({ now: new Date('2026-11-06T12:00:00Z') });

    const data = new URLSearchParams(signInitData(USER, BOT_TOKEN));

    expect(data.get('auth_date')).toBe('1793966400');
  });

  it('uses opts.authDate as auth_date', () => {
    const data = new URLSearchParams(signInitData(USER, BOT_TOKEN, { authDate: 1700000000 }));

    expect(data.get('auth_date')).toBe('1700000000');
    expect(data.get('hash')).toBe(expectedHash(data, BOT_TOKEN));
  });

  it('adds start_param only when opts.startParam is given', () => {
    const withParam = new URLSearchParams(signInitData(USER, BOT_TOKEN, { startParam: 'shop' }));
    const without = new URLSearchParams(signInitData(USER, BOT_TOKEN));

    expect(withParam.get('start_param')).toBe('shop');
    expect(withParam.get('hash')).toBe(expectedHash(withParam, BOT_TOKEN));
    expect(without.has('start_param')).toBe(false);
  });

  it('adds opts.extra fields and covers them with the hash', () => {
    const data = new URLSearchParams(
      signInitData(USER, BOT_TOKEN, {
        extra: { chat_type: 'private', chat_instance: '-8051234567890' },
      }),
    );

    expect(data.get('chat_type')).toBe('private');
    expect(data.get('chat_instance')).toBe('-8051234567890');
    expect(data.get('hash')).toBe(expectedHash(data, BOT_TOKEN));

    data.set('chat_type', 'group');
    expect(data.get('hash')).not.toBe(expectedHash(data, BOT_TOKEN));
  });
});

describe('tmaAuth', () => {
  it('returns "tma " followed by initData signed for the bot token', () => {
    const header = tmaAuth(USER, BOT_TOKEN);

    expect(header.startsWith('tma ')).toBe(true);
    const data = new URLSearchParams(header.slice('tma '.length));
    expect(JSON.parse(data.get('user')!)).toEqual(USER);
    expect(data.get('hash')).toBe(expectedHash(data, BOT_TOKEN));
  });
});
