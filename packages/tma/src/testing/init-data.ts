import { createHmac, randomBytes } from 'crypto';

export interface TgUserInput {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface SignInitDataOptions {
  authDate?: number;
  startParam?: string;
  extra?: Record<string, string>;
}

export function signInitData(
  user: TgUserInput,
  botToken: string,
  opts: SignInitDataOptions = {},
): string {
  const fields: Record<string, string> = {
    query_id: 'AAH' + randomBytes(9).toString('base64url'),
    ...(opts.extra ?? {}),
    user: JSON.stringify(user),
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
  };
  if (opts.startParam !== undefined) fields.start_param = opts.startParam;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

export function tmaAuth(user: TgUserInput, botToken: string): string {
  return 'tma ' + signInitData(user, botToken);
}
