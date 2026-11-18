import { DynamicModule, Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { AdminUserCardRegistry, TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { Knex } from 'knex';
import { BotController } from './bot.controller';
import { BroadcastAudienceRegistry } from './broadcast/audience.registry';
import { BroadcastAdminController } from './broadcast/broadcast-admin.controller';
import { BroadcastService } from './broadcast/broadcast.service';
import { BroadcastWorker } from './broadcast/broadcast.worker';
import { BotService } from './bot.service';
import { NotificationsService } from './notifications.service';
import { resolveBotOptions, TMA_BOT_OPTIONS, TmaBotOptions } from './options';
import { PreparedMessagesService } from './prepared-messages.service';

@Global()
@Module({})
export class TmaBotModule implements OnModuleInit {
  constructor(
    private readonly cards: AdminUserCardRegistry,
    @Inject(TMA_KNEX) private readonly knex: Knex,
  ) {}

  static forRoot(opts: TmaBotOptions): DynamicModule {
    const resolved = resolveBotOptions(opts);
    return {
      module: TmaBotModule,
      controllers: [BotController, BroadcastAdminController],
      providers: [
        { provide: TMA_BOT_OPTIONS, useValue: resolved },
        BotService,
        NotificationsService,
        PreparedMessagesService,
        BroadcastAudienceRegistry,
        BroadcastService,
        BroadcastWorker,
      ],
      exports: [
        TMA_BOT_OPTIONS,
        BotService,
        NotificationsService,
        PreparedMessagesService,
        BroadcastAudienceRegistry,
        BroadcastService,
        BroadcastWorker,
      ],
    };
  }

  onModuleInit(): void {
    this.cards.register('bot', async (userId) => {
      const row = await this.knex('users').where({ id: userId }).first('bot_blocked_at');
      return row ? { botBlockedAt: row.bot_blocked_at } : null;
    });
  }
}
