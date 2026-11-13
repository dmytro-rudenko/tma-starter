import { createHmac, timingSafeEqual } from 'crypto';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec: number,
  now = Date.now(),
): TgUser | null {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;

  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const ageSec = now / 1000 - authDate;
  if (ageSec > maxAgeSec || ageSec < -60) return null;

  try {
    const user = JSON.parse(params.get('user') ?? '') as TgUser;
    if (typeof user?.id !== 'number' || typeof user.first_name !== 'string') return null;
    return user;
  } catch {
    return null;
  }
}
