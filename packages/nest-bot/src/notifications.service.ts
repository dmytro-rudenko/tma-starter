import { Inject, Injectable, Logger } from '@nestjs/common';
import { TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { GrammyError } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { Knex } from 'knex';
import { BotService } from './bot.service';
import { BotLang, langOf } from './lang';

export type NotificationResult = 'sent' | 'skipped' | 'bot_blocked' | 'failed';

export interface NotificationOptions {
  markup?: (lang: BotLang) => InlineKeyboardMarkup;
}

const guardLogger = new Logger('NotificationsGuard');

export async function guard<T>(what: string, fn: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    guardLogger.warn(`${what} failed: ${String(err)}`);
    return undefined;
  }
}

export function retryAfterOf(err: unknown): number | undefined {
  if (err instanceof GrammyError && err.error_code === 429) return err.parameters.retry_after ?? 1;
  return undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly bots: BotService,
  ) {}

  async send(
    userId: number,
    text: (lang: BotLang) => string,
    opts: NotificationOptions = {},
  ): Promise<NotificationResult> {
    try {
      const row = await this.knex('users')
        .where({ id: userId })
        .first('language', 'language_code', 'blocked_at', 'bot_blocked_at');
      if (!row || row.blocked_at || row.bot_blocked_at) return 'skipped';
      const lang = langOf(row.language ?? row.language_code);
      return await this.deliver(userId, text(lang), opts.markup?.(lang), true);
    } catch (err) {
      this.logger.warn(`send to ${userId} failed: ${String(err)}`);
      return 'failed';
    }
  }

  async markBotBlocked(userId: number): Promise<void> {
    await this.knex('users').where({ id: userId }).update({ bot_blocked_at: this.knex.fn.now() });
  }

  private async deliver(
    userId: number,
    text: string,
    markup: InlineKeyboardMarkup | undefined,
    retry: boolean,
  ): Promise<NotificationResult> {
    try {
      await this.bots.bot.api.sendMessage(userId, text, {
        parse_mode: 'HTML',
        reply_markup: markup,
      });
      return 'sent';
    } catch (err) {
      if (err instanceof GrammyError && err.error_code === 403) {
        await this.markBotBlocked(userId);
        return 'bot_blocked';
      }
      const retryAfter = retryAfterOf(err);
      if (retryAfter !== undefined && retry) {
        await sleep(retryAfter * 1000);
        return this.deliver(userId, text, markup, false);
      }
      this.logger.warn(`sendMessage to ${userId} failed: ${String(err)}`);
      return 'failed';
    }
  }
}
