import type { Api } from 'grammy';
import type { BotCommand, LanguageCode } from 'grammy/types';

export interface BotProfileLanguage {
  short_description: string;
  description: string;
  commands: BotCommand[];
}

export interface BotProfile {
  menuButtonText: string;
  en: BotProfileLanguage;
  [languageCode: string]: BotProfileLanguage | string;
}

export interface BotProfileFailure {
  method: string;
  languageCode: string | null;
  error: string;
}

const FALLBACK_LANGUAGE = 'en';

export async function syncBotProfile(
  api: Api,
  profile: BotProfile,
  webappUrl: string,
): Promise<BotProfileFailure[]> {
  const calls: Array<{ method: string; languageCode: string | null; run: () => Promise<unknown> }> = [
    {
      method: 'setChatMenuButton',
      languageCode: null,
      run: () =>
        api.setChatMenuButton({
          menu_button: { type: 'web_app', text: profile.menuButtonText, web_app: { url: webappUrl } },
        }),
    },
  ];
  for (const [key, entry] of Object.entries(profile)) {
    if (key === 'menuButtonText' || typeof entry !== 'object' || entry === null) continue;
    const languageCode = key === FALLBACK_LANGUAGE ? null : key;
    const other = languageCode ? { language_code: languageCode as LanguageCode } : {};
    calls.push(
      {
        method: 'setMyDescription',
        languageCode,
        run: () => api.setMyDescription(entry.description, other),
      },
      {
        method: 'setMyShortDescription',
        languageCode,
        run: () => api.setMyShortDescription(entry.short_description, other),
      },
      {
        method: 'setMyCommands',
        languageCode,
        run: () => api.setMyCommands(entry.commands, other),
      },
    );
  }
  const results = await Promise.allSettled(calls.map((c) => c.run()));
  return results.flatMap((result, i) =>
    result.status === 'rejected'
      ? [
          {
            method: calls[i].method,
            languageCode: calls[i].languageCode,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        ]
      : [],
  );
}
