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
export {
  BroadcastAudienceFilter,
  BroadcastAudienceFilterView,
  BroadcastAudienceRegistry,
} from './broadcast/audience.registry';
export {
  BROADCAST_PAGE_SIZE,
  BroadcastAudience,
  BroadcastButton,
  BroadcastInput,
  BroadcastListQuery,
  BroadcastPage,
  BroadcastService,
  BroadcastStatus,
  BroadcastView,
  parseBroadcastAudience,
  parseBroadcastInput,
} from './broadcast/broadcast.service';
export {
  BROADCAST_BATCH_SIZE,
  BROADCAST_IDLE_MS,
  BROADCAST_MAX_ATTEMPTS,
  BROADCAST_SEND_INTERVAL_MS,
  BroadcastWorker,
} from './broadcast/broadcast.worker';
export { BroadcastAdminController } from './broadcast/broadcast-admin.controller';
export {
  BotProfile,
  BotProfileFailure,
  BotProfileLanguage,
  syncBotProfile,
} from './setup/sync-bot-profile';
export { migrations } from './migrations';

export const TMA_BOT_ERROR_CODES = ['BROADCAST_NOT_FOUND'] as const;
