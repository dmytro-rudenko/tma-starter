import { BotCopyOverrides, BotCopyTable, resolveBotCopy } from './copy';
import type { StartParamRoute } from './start-param.router';

export const TMA_BOT_OPTIONS = Symbol('TMA_BOT_OPTIONS');

export interface TmaBotOptions {
  botToken: string;
  botUsername: string;
  webappUrl: string;
  webhookPathToken: string;
  webhookSecret: string;
  apiRoot?: string;
  copy?: BotCopyOverrides;
  startParams?: StartParamRoute[];
  runWorker: boolean;
}

export interface ResolvedTmaBotOptions {
  botToken: string;
  botUsername: string;
  webappUrl: string;
  webhookPathToken: string;
  webhookSecret: string;
  apiRoot?: string;
  copy: BotCopyTable;
  startParams: StartParamRoute[];
  runWorker: boolean;
}

const REQUIRED = [
  'botToken',
  'botUsername',
  'webappUrl',
  'webhookPathToken',
  'webhookSecret',
] as const;

export function resolveBotOptions(opts: TmaBotOptions): ResolvedTmaBotOptions {
  for (const key of REQUIRED) {
    if (!opts?.[key]) throw new Error(`TmaBotModule.forRoot: ${key} is required`);
  }
  return {
    botToken: opts.botToken,
    botUsername: opts.botUsername,
    webappUrl: opts.webappUrl,
    webhookPathToken: opts.webhookPathToken,
    webhookSecret: opts.webhookSecret,
    apiRoot: opts.apiRoot,
    copy: resolveBotCopy(opts.copy),
    startParams: opts.startParams ?? [],
    runWorker: opts.runWorker,
  };
}
