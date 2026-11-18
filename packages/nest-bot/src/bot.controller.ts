import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { apiError, Public } from '@dmytro-rudenko/tma-nest-core';
import { timingSafeEqual } from 'crypto';
import type { Update } from 'grammy/types';
import { BotService } from './bot.service';
import { ResolvedTmaBotOptions, TMA_BOT_OPTIONS } from './options';

function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly bots: BotService,
    @Inject(TMA_BOT_OPTIONS) private readonly opts: ResolvedTmaBotOptions,
  ) {}

  @Public()
  @SkipThrottle()
  @Post(':pathToken')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Param('pathToken') pathToken: string,
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: Update,
  ): Promise<Record<string, never>> {
    if (
      !safeEqual(pathToken, this.opts.webhookPathToken) ||
      !safeEqual(secret, this.opts.webhookSecret)
    ) {
      throw apiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED');
    }
    try {
      await this.bots.bot.handleUpdate(update);
    } catch (err) {
      const critical = this.bots.isCritical(update);
      this.logger.error(
        `update ${update?.update_id} failed${critical ? ' (critical)' : ''}: ${String(err)}`,
      );
      if (critical) throw err;
    }
    return {};
  }
}
