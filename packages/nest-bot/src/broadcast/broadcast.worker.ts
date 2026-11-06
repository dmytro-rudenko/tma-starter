import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { GrammyError } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { Knex } from 'knex';
import { BotService } from '../bot.service';
import { NotificationsService, retryAfterOf } from '../notifications.service';
import { ResolvedTmaBotOptions, TMA_BOT_OPTIONS } from '../options';
import { BroadcastButton, BroadcastService } from './broadcast.service';

export const BROADCAST_BATCH_SIZE = 25;
export const BROADCAST_SEND_INTERVAL_MS = 40;
export const BROADCAST_MAX_ATTEMPTS = 3;
export const BROADCAST_IDLE_MS = 200;

interface ClaimedBroadcast {
  id: string;
  text: string;
  button: BroadcastButton | null;
  status: string;
}

interface ClaimedDelivery {
  user_id: string | number;
  attempts: number;
}

type Outcome = 'sent' | 'failed' | 'pending';

@Injectable()
export class BroadcastWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BroadcastWorker.name);
  private stopped = false;
  private loop?: Promise<void>;
  private readonly sleepers = new Set<() => void>();

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_BOT_OPTIONS) private readonly opts: ResolvedTmaBotOptions,
    private readonly bots: BotService,
    private readonly notifications: NotificationsService,
    private readonly broadcasts: BroadcastService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.opts.runWorker) this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const wake of [...this.sleepers]) wake();
    await this.loop;
  }

  async tick(): Promise<boolean> {
    const broadcast: ClaimedBroadcast | undefined = await this.knex('broadcasts')
      .whereIn('status', ['queued', 'running'])
      .orderBy([{ column: 'created_at' }, { column: 'id' }])
      .first('id', 'text', 'button', 'status');
    if (!broadcast) return false;
    if (broadcast.status === 'queued') {
      await this.knex('broadcasts')
        .where({ id: broadcast.id, status: 'queued' })
        .update({ status: 'running', started_at: this.knex.raw('coalesce(started_at, now())') });
    }
    const markup = this.broadcasts.markup(broadcast.button);
    const processed = await this.knex.transaction(async (trx) => {
      const rows: ClaimedDelivery[] = await trx('broadcast_deliveries')
        .where({ broadcast_id: broadcast.id, status: 'pending' })
        .whereExists(
          trx('broadcasts')
            .where('broadcasts.id', broadcast.id)
            .whereIn('broadcasts.status', ['queued', 'running']),
        )
        .orderBy('user_id')
        .limit(BROADCAST_BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .select('user_id', 'attempts');
      let sent = 0;
      let failed = 0;
      for (const [i, row] of rows.entries()) {
        if (this.stopped) break;
        if (i > 0) await this.pause(BROADCAST_SEND_INTERVAL_MS);
        const outcome = await this.deliver(trx, broadcast, markup, row);
        if (outcome === 'sent') sent++;
        if (outcome === 'failed') failed++;
      }
      if (sent || failed) {
        await trx('broadcasts')
          .where({ id: broadcast.id })
          .update({ sent: trx.raw('sent + ?', [sent]), failed: trx.raw('failed + ?', [failed]) });
      }
      return rows.length;
    });
    await this.finishIfDrained(broadcast.id);
    return processed > 0;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let worked = false;
      try {
        worked = await this.tick();
      } catch (err) {
        this.logger.error(`broadcast tick failed: ${String(err)}`);
      }
      if (!worked) await this.pause(BROADCAST_IDLE_MS);
    }
  }

  private async deliver(
    trx: Knex.Transaction,
    broadcast: ClaimedBroadcast,
    markup: InlineKeyboardMarkup | undefined,
    row: ClaimedDelivery,
  ): Promise<Outcome> {
    const userId = Number(row.user_id);
    const where = { broadcast_id: broadcast.id, user_id: userId };
    try {
      await this.bots.bot.api.sendMessage(userId, broadcast.text, {
        parse_mode: 'HTML',
        reply_markup: markup,
      });
      await trx('broadcast_deliveries')
        .where(where)
        .update({ status: 'sent', sent_at: trx.fn.now(), attempts: row.attempts + 1, error: null });
      return 'sent';
    } catch (err) {
      const retryAfter = retryAfterOf(err);
      if (retryAfter !== undefined) {
        await this.pause(retryAfter * 1000);
        return 'pending';
      }
      const error = err instanceof GrammyError ? err.description : String(err);
      const code = err instanceof GrammyError ? err.error_code : undefined;
      if (code !== undefined && code >= 400 && code < 500) {
        if (code === 403) await this.notifications.markBotBlocked(userId);
        await trx('broadcast_deliveries')
          .where(where)
          .update({ status: 'failed', attempts: row.attempts + 1, error });
        return 'failed';
      }
      const attempts = row.attempts + 1;
      const outcome: Outcome = attempts >= BROADCAST_MAX_ATTEMPTS ? 'failed' : 'pending';
      await trx('broadcast_deliveries').where(where).update({ status: outcome, attempts, error });
      return outcome;
    }
  }

  private async finishIfDrained(id: string): Promise<void> {
    await this.knex.raw(
      `update broadcasts b
          set status = 'done',
              finished_at = now(),
              sent = (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'sent'),
              failed = (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'failed')
        where b.id = ?
          and b.status in ('queued', 'running')
          and not exists (
            select 1 from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'pending'
          )`,
      [id],
    );
  }

  private pause(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.sleepers.add(done);
    });
  }
}
