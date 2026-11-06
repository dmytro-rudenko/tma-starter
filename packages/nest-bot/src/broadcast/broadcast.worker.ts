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
export const BROADCAST_LEASE_MINUTES = 5;
export const BROADCAST_PAUSE_CHUNK_MS = 120_000;
export const BROADCAST_MAX_RATE_LIMIT_RETRIES = 5;

const ACTIVE = ['queued', 'running'];
const LEASE_EXPIRED = `now() - interval '${BROADCAST_LEASE_MINUTES} minutes'`;

interface ClaimedBroadcast {
  id: string;
  text: string;
  button: BroadcastButton | null;
}

type SendResult =
  | { kind: 'retry'; ms: number }
  | { kind: 'done'; botBlocked: boolean; patch: Record<string, unknown> };

interface ClaimedDelivery {
  user_id: string | number;
  attempts: number;
}

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
    await this.finishDrained();
    const claimed = await this.claim();
    if (!claimed) return false;
    const { broadcast, rows } = claimed;
    const markup = this.broadcasts.markup(broadcast.button);
    let next = 0;
    let gap = false;
    let retries = 0;
    try {
      while (next < rows.length) {
        if (this.stopped || !(await this.isActive(broadcast.id))) break;
        if (gap) {
          await this.pause(BROADCAST_SEND_INTERVAL_MS);
          if (this.stopped) break;
        }
        const row = rows[next];
        const result = await this.send(broadcast, markup, row);
        if (result.kind === 'retry') {
          retries++;
          if (!(await this.backoff(broadcast.id, rows.slice(next), result.ms))) break;
          if (retries > BROADCAST_MAX_RATE_LIMIT_RETRIES) break;
          gap = false;
          continue;
        }
        next++;
        gap = true;
        retries = 0;
        await this.write(broadcast.id, Number(row.user_id), result.patch);
        if (result.botBlocked) {
          await this.settle('mark bot blocked', () =>
            this.notifications.markBotBlocked(Number(row.user_id)),
          );
        }
      }
    } finally {
      await this.settle('release claims', () => this.release(broadcast.id, rows.slice(next)));
      await this.settle('refresh counters', () => this.refreshCounters(broadcast.id));
      await this.settle('finish broadcast', () => this.finishDrained(broadcast.id));
    }
    return true;
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

  private claimable(db: Knex | Knex.Transaction, broadcastRef: string | Knex.Raw) {
    return db('broadcast_deliveries')
      .where('broadcast_deliveries.broadcast_id', broadcastRef)
      .where('broadcast_deliveries.status', 'pending')
      .where((q) =>
        q
          .whereNull('broadcast_deliveries.claimed_at')
          .orWhere('broadcast_deliveries.claimed_at', '<', db.raw(LEASE_EXPIRED)),
      );
  }

  private claim(): Promise<{ broadcast: ClaimedBroadcast; rows: ClaimedDelivery[] } | null> {
    return this.knex.transaction(async (trx) => {
      const broadcast: ClaimedBroadcast | undefined = await trx('broadcasts')
        .whereIn('status', ACTIVE)
        .whereExists(this.claimable(trx, trx.ref('broadcasts.id')).select(trx.raw('1')))
        .orderBy([{ column: 'created_at' }, { column: 'id' }])
        .first('id', 'text', 'button');
      if (!broadcast) return null;
      const rows: ClaimedDelivery[] = await this.claimable(trx, broadcast.id)
        .orderBy('user_id')
        .limit(BROADCAST_BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .select('user_id', 'attempts');
      if (!rows.length) return null;
      await trx('broadcast_deliveries')
        .where({ broadcast_id: broadcast.id })
        .whereIn(
          'user_id',
          rows.map((r) => r.user_id),
        )
        .update({ claimed_at: trx.fn.now() });
      await trx('broadcasts')
        .where({ id: broadcast.id, status: 'queued' })
        .update({ status: 'running', started_at: trx.raw('coalesce(started_at, now())') });
      return { broadcast, rows };
    });
  }

  private async isActive(id: string): Promise<boolean> {
    const row = await this.knex('broadcasts').where({ id }).first('status');
    return !!row && ACTIVE.includes(row.status);
  }

  private async send(
    broadcast: ClaimedBroadcast,
    markup: InlineKeyboardMarkup | undefined,
    row: ClaimedDelivery,
  ): Promise<SendResult> {
    const attempts = row.attempts + 1;
    try {
      await this.bots.bot.api.sendMessage(Number(row.user_id), broadcast.text, {
        parse_mode: 'HTML',
        reply_markup: markup,
      });
    } catch (err) {
      const retryAfter = retryAfterOf(err);
      if (retryAfter !== undefined)
        return { kind: 'retry', ms: Math.max(1, retryAfter || 0) * 1000 };
      const error = err instanceof GrammyError ? err.description : String(err);
      const code = err instanceof GrammyError ? err.error_code : undefined;
      if (code !== undefined && code >= 400 && code < 500) {
        return {
          kind: 'done',
          botBlocked: code === 403,
          patch: { status: 'failed', attempts, error, claimed_at: null },
        };
      }
      return {
        kind: 'done',
        botBlocked: false,
        patch: {
          status: attempts >= BROADCAST_MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          error,
          claimed_at: null,
        },
      };
    }
    return {
      kind: 'done',
      botBlocked: false,
      patch: {
        status: 'sent',
        sent_at: this.knex.fn.now(),
        attempts,
        error: null,
        claimed_at: null,
      },
    };
  }

  private async backoff(
    broadcastId: string,
    rows: ClaimedDelivery[],
    ms: number,
  ): Promise<boolean> {
    let left = ms;
    while (left > 0) {
      await this.renew(broadcastId, rows);
      const chunk = Math.min(left, BROADCAST_PAUSE_CHUNK_MS);
      await this.pause(chunk);
      left -= chunk;
      if (this.stopped || !(await this.isActive(broadcastId))) return false;
    }
    await this.renew(broadcastId, rows);
    return true;
  }

  private async renew(broadcastId: string, rows: ClaimedDelivery[]): Promise<void> {
    if (!rows.length) return;
    await this.knex('broadcast_deliveries')
      .where({ broadcast_id: broadcastId, status: 'pending' })
      .whereIn(
        'user_id',
        rows.map((r) => r.user_id),
      )
      .update({ claimed_at: this.knex.fn.now() });
  }

  private async settle(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(`broadcast ${what} failed: ${String(err)}`);
    }
  }

  private write(broadcastId: string, userId: number, patch: Record<string, unknown>) {
    return this.knex('broadcast_deliveries')
      .where({ broadcast_id: broadcastId, user_id: userId, status: 'pending' })
      .update(patch);
  }

  private async release(broadcastId: string, rows: ClaimedDelivery[]): Promise<void> {
    if (!rows.length) return;
    await this.knex('broadcast_deliveries')
      .where({ broadcast_id: broadcastId, status: 'pending' })
      .whereIn(
        'user_id',
        rows.map((r) => r.user_id),
      )
      .update({ claimed_at: null });
  }

  private async refreshCounters(id: string): Promise<void> {
    await this.knex.raw(
      `update broadcasts b
          set sent = greatest(b.sent, (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'sent')),
              failed = greatest(b.failed, (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'failed'))
        where b.id = ?`,
      [id],
    );
  }

  private async finishDrained(id?: string): Promise<void> {
    await this.knex.raw(
      `update broadcasts b
          set status = 'done',
              finished_at = now(),
              sent = (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'sent'),
              failed = (select count(*) from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'failed')
        where b.status in ('queued', 'running')
          ${id ? 'and b.id = ?' : ''}
          and not exists (
            select 1 from broadcast_deliveries d where d.broadcast_id = b.id and d.status = 'pending'
          )`,
      id ? [id] : [],
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
