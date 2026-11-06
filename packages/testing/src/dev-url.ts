import { signInitData, TgUserInput } from './init-data';

export function devUrl({
  baseUrl,
  user,
  botToken,
  startParam,
}: {
  baseUrl: string;
  user: TgUserInput;
  botToken: string;
  startParam?: string;
}): string {
  const signed = signInitData(user, botToken, startParam !== undefined ? { startParam } : {});
  return `${baseUrl.replace(/\/+$/, '')}/#tgWebAppData=${encodeURIComponent(signed)}&tgWebAppVersion=8.0&tgWebAppPlatform=tdesktop`;
}
