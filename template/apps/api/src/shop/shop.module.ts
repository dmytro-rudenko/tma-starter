import { Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  BotService,
  escapeHtml,
  ResolvedTmaBotOptions,
  TMA_BOT_OPTIONS,
} from '@dmytro-rudenko/tma-nest-bot';
import { PremiumController } from './premium.controller';

const SHOP_BUTTON = { uk: '🛍 Магазин', en: '🛍 Shop' };

@Module({
  controllers: [PremiumController],
})
export class ShopModule implements OnModuleInit {
  constructor(
    @Inject(TMA_BOT_OPTIONS) private readonly botOptions: ResolvedTmaBotOptions,
    private readonly bot: BotService,
  ) {}

  onModuleInit(): void {
    this.botOptions.startParams.push({
      pattern: /^shop$/,
      handle: async (ctx) => {
        const copy = this.bot.copyFor(ctx);
        const button = copy.openButton ?? SHOP_BUTTON[this.bot.langFor(ctx)];
        const name = escapeHtml(ctx.from?.first_name ?? '') || undefined;
        await ctx.reply(copy.greeting ? copy.greeting(name) : escapeHtml(button), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: button, url: this.bot.startAppUrl('shop') }]],
          },
        });
      },
    });
  }
}
