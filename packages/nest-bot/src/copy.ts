import type { BotLang } from './lang';

export interface BotCopy {
  greeting(name?: string): string;
  openButton: string;
  help: string;
  payRejected: string;
  paymentReceived(title: string): string;
  subscriptionRenewed(title: string, until: string): string;
  subscriptionCanceled(title: string, until: string): string;
  paymentRefunded(title: string, stars: number): string;
}

export type BotCopyEntries = { [K in keyof BotCopy]: BotCopy[K] | null };

export type BotCopyOverrides = Partial<Record<BotLang, Partial<BotCopyEntries>>>;

export type BotCopyTable = Record<BotLang, BotCopyEntries>;

export const DEFAULT_BOT_COPY: Record<BotLang, BotCopy> = {
  uk: {
    greeting: (name) =>
      `👋 Привіт${name ? `, <b>${name}</b>` : ''}! Натисни кнопку нижче, щоб відкрити застосунок.`,
    openButton: '🚀 Відкрити',
    help: 'ℹ️ Усе потрібне — у застосунку. Натисни кнопку нижче, щоб відкрити його.',
    payRejected: 'Оплату зараз прийняти неможливо',
    paymentReceived: (title) => `✅ Оплату отримано: <b>${title}</b>. Дякуємо!`,
    subscriptionRenewed: (title, until) => `🔄 Підписку <b>${title}</b> продовжено до ${until}.`,
    subscriptionCanceled: (title, until) =>
      `⏸ Підписку <b>${title}</b> скасовано. Доступ збережеться до ${until}.`,
    paymentRefunded: (title, stars) => `↩️ Повернуто ${stars} ⭐ за <b>${title}</b>.`,
  },
  en: {
    greeting: (name) =>
      `👋 Hi${name ? `, <b>${name}</b>` : ''}! Tap the button below to open the app.`,
    openButton: '🚀 Open',
    help: 'ℹ️ Everything you need is in the app. Tap the button below to open it.',
    payRejected: 'This payment cannot be accepted right now',
    paymentReceived: (title) => `✅ Payment received: <b>${title}</b>. Thank you!`,
    subscriptionRenewed: (title, until) =>
      `🔄 Your <b>${title}</b> subscription is renewed until ${until}.`,
    subscriptionCanceled: (title, until) =>
      `⏸ Your <b>${title}</b> subscription is canceled. Access stays until ${until}.`,
    paymentRefunded: (title, stars) => `↩️ Refunded ${stars} ⭐ for <b>${title}</b>.`,
  },
};

export function resolveBotCopy(overrides: BotCopyOverrides = {}): BotCopyTable {
  return {
    uk: { ...DEFAULT_BOT_COPY.uk, ...overrides.uk },
    en: { ...DEFAULT_BOT_COPY.en, ...overrides.en },
  };
}
