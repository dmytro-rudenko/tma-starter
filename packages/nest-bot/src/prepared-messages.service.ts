import { Injectable } from '@nestjs/common';
import type { InlineQueryResultArticle } from 'grammy/types';
import { BotService } from './bot.service';

@Injectable()
export class PreparedMessagesService {
  constructor(private readonly bots: BotService) {}

  async save(userId: number, result: InlineQueryResultArticle): Promise<string> {
    const prepared = await this.bots.bot.api.savePreparedInlineMessage(userId, result, {
      allow_user_chats: true,
      allow_group_chats: true,
      allow_bot_chats: false,
      allow_channel_chats: false,
    });
    return prepared.id;
  }
}
