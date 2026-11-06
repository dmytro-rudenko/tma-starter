export { TmaBotModule } from './bot.module';
export { ResolvedTmaBotOptions, TMA_BOT_OPTIONS, TmaBotOptions } from './options';
export { BotOnOptions, BotService } from './bot.service';
export { BotController } from './bot.controller';
export { StartParamRoute, StartParamRouter } from './start-param.router';
export {
  BotCopy,
  BotCopyEntries,
  BotCopyOverrides,
  BotCopyTable,
  DEFAULT_BOT_COPY,
  resolveBotCopy,
} from './copy';
export { BotLang, escapeHtml, langOf } from './lang';
export {
  NotificationOptions,
  NotificationResult,
  NotificationsService,
  guard,
  retryAfterOf,
} from './notifications.service';
export { PreparedMessagesService } from './prepared-messages.service';
export { migrations } from './migrations';

export const TMA_BOT_ERROR_CODES = [] as const;
