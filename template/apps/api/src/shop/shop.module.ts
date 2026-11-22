import { Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  BotService,
  escapeHtml,
  ResolvedTmaBotOptions,
  TMA_BOT_OPTIONS,
} from '@dmytro-rudenko/tma-nest-bot';
import { PremiumController } from './premium.controller';

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
        if (!copy.greeting || !copy.openButton) return;
        const name = escapeHtml(ctx.from?.first_name ?? '') || undefined;
        await ctx.reply(copy.greeting(name), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: copy.openButton, url: this.bot.startAppUrl('shop') }]],
          },
        });
      },
    });
  }
}
