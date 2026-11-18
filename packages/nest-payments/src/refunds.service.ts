import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { apiError, AuditService, TMA_KNEX, UsersService } from '@dmytro-rudenko/tma-nest-core';
import {
  BotCopyEntries,
  BotLang,
  BotService,
  escapeHtml,
  langOf,
  NotificationsService,
} from '@dmytro-rudenko/tma-nest-bot';
import type { Knex } from 'knex';
import { ResolvedTmaPaymentsOptions, TMA_PAYMENTS_OPTIONS } from './options';
import type { PaymentRow } from './product';
import { ProductRegistry } from './product.registry';

const REFUND_RETRY_BATCH = 20;
const REFUND_BACKOFF_MAX_MIN = 1440;
const REFUND_ATTEMPTS_WARN = 5;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RefundHook = (trx: Knex.Transaction, payment: PaymentRow) => Promise<void>;

export function alreadyRefunded(err: unknown): boolean {
  const e = err as { description?: unknown; message?: unknown } | null;
  return /CHARGE_ALREADY_REFUNDED/.test(
    `${String(e?.description ?? '')} ${String(e?.message ?? '')}`,
  );
}

@Injectable()
export class RefundsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RefundsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private retrying?: Promise<void>;

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_PAYMENTS_OPTIONS) private readonly opts: ResolvedTmaPaymentsOptions,
    private readonly registry: ProductRegistry,
    private readonly bots: BotService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.opts.runWorker) return;
    this.timer = setInterval(() => void this.retryPendingRefunds(), this.opts.refundRetryIntervalMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.retrying;
  }

  async refundStars(payerId: number, chargeId: string): Promise<void> {
    try {
      await this.bots.bot.api.refundStarPayment(payerId, chargeId);
    } catch (err) {
      if (!alreadyRefunded(err)) throw err;
    }
  }

  async refundPending(payment: PaymentRow): Promise<PaymentRow | undefined> {
    try {
      await this.refundStars(Number(payment.payer_id), payment.telegram_payment_charge_id);
    } catch (err) {
      this.logger.error(
        `refund ${payment.telegram_payment_charge_id} failed, stays refund_pending: ${String(err)}`,
      );
      throw err;
    }
    return this.finish(payment);
  }

  async refund(actorId: number, paymentId: string): Promise<PaymentRow> {
    if (!UUID_RE.test(paymentId)) throw apiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND');
    const current: PaymentRow | undefined = await this.knex('payments').where({ id: paymentId }).first();
    if (!current) throw apiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND');
    let pending: PaymentRow | undefined = current;
    if (current.status === 'paid') {
      [pending] = await this.knex('payments')
        .where({ id: paymentId, status: 'paid' })
        .update({ status: 'refund_pending' })
        .returning('*');
      pending ??= await this.knex('payments').where({ id: paymentId }).first();
    }
    if (!pending || pending.status !== 'refund_pending') {
      throw apiError(HttpStatus.CONFLICT, 'ALREADY_REFUNDED');
    }
    try {
      await this.refundStars(Number(pending.payer_id), pending.telegram_payment_charge_id);
    } catch (err) {
      this.logger.error(`admin refund ${pending.telegram_payment_charge_id} failed: ${String(err)}`);
      await this.recordFailedAttempt(pending);
      throw apiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
    const done = await this.finish(pending, (trx, row) =>
      this.audit.record(trx, {
        actorId,
        action: 'payment.refund',
        targetType: 'payment',
        targetId: row.id,
        meta: {
          payerId: Number(row.payer_id),
          productId: row.product_id,
          amountStars: row.amount_stars,
          chargeId: row.telegram_payment_charge_id,
        },
      }),
    );
    if (!done) throw apiError(HttpStatus.CONFLICT, 'ALREADY_REFUNDED');
    return done;
  }

  async retryPendingRefunds(): Promise<void> {
    if (this.retrying) return this.retrying;
    this.retrying = (async () => {
      try {
        const rows: PaymentRow[] = await this.knex('payments')
          .where({ status: 'refund_pending' })
          .where((w) =>
            w
              .whereNull('refund_attempted_at')
              .orWhereRaw(
                "refund_attempted_at < now() - interval '1 minute' * least(power(2, refund_attempts), ?)",
                [REFUND_BACKOFF_MAX_MIN],
              ),
          )
          .orderByRaw('refund_attempted_at asc nulls first, created_at asc')
          .limit(REFUND_RETRY_BATCH);
        for (const row of rows) {
          try {
            await this.refundPending(row);
          } catch {
            await this.recordFailedAttempt(row);
          }
        }
      } catch (err) {
        this.logger.error(`refund retry failed: ${String(err)}`);
      } finally {
        this.retrying = undefined;
      }
    })();
    return this.retrying;
  }

  async notify(
    userId: number,
    render: (copy: BotCopyEntries, lang: BotLang) => string | null,
  ): Promise<void> {
    try {
      const user = await this.users.get(userId);
      const lang = langOf(user?.language ?? user?.languageCode);
      const text = render(this.bots.copy[lang], lang);
      if (text !== null) await this.notifications.send(userId, () => text);
    } catch (err) {
      this.logger.warn(`notify ${userId} failed: ${String(err)}`);
    }
  }

  private async finish(payment: PaymentRow, hook?: RefundHook): Promise<PaymentRow | undefined> {
    const product = this.registry.get(payment.product_id);
    const result = await this.knex.transaction(async (trx) => {
      const [row]: PaymentRow[] = await trx('payments')
        .where({ id: payment.id, status: 'refund_pending' })
        .update({ status: 'refunded', refunded_at: trx.fn.now() })
        .returning('*');
      if (!row) return undefined;
      let cancelCharge: string | null = null;
      if (row.settled_at !== null) {
        await product?.onRefund?.(trx, row);
        cancelCharge = await this.revoke(trx, row, !!product?.repeatable);
      }
      await hook?.(trx, row);
      return { row, cancelCharge };
    });
    if (!result) return undefined;
    const { row, cancelCharge } = result;
    const payerId = Number(row.payer_id);
    if (cancelCharge) {
      try {
        await this.bots.bot.api.editUserStarSubscription(payerId, cancelCharge, true);
      } catch (err) {
        this.logger.warn(`cancel subscription ${cancelCharge} after refund failed: ${String(err)}`);
      }
    }
    if (product) {
      void this.notify(payerId, (copy, lang) =>
        copy.paymentRefunded?.(escapeHtml(product.title(lang)), row.amount_stars) ?? null,
      );
    }
    return row;
  }

  private async revoke(
    trx: Knex.Transaction,
    row: PaymentRow,
    repeatable: boolean,
  ): Promise<string | null> {
    const key = { user_id: row.payer_id, product_id: row.product_id };
    if (!row.is_recurring) {
      if (row.target_id === null && !repeatable) {
        await trx('entitlements').where({ ...key, source: 'one_time' }).del();
      }
      return null;
    }
    const [ent]: { subscription_charge_id: string | null }[] = await trx('entitlements')
      .where({ ...key, source: 'subscription' })
      .whereIn(
        'subscription_charge_id',
        trx('payments')
          .select('telegram_payment_charge_id')
          .where({ payer_id: row.payer_id, invoice_payload: row.invoice_payload, is_recurring: true }),
      )
      .update({
        expires_at: trx.fn.now(),
        canceled_at: trx.raw('coalesce(canceled_at, now())'),
        updated_at: trx.fn.now(),
      })
      .returning('subscription_charge_id');
    return ent?.subscription_charge_id ?? null;
  }

  private async recordFailedAttempt(row: PaymentRow): Promise<void> {
    const [updated]: PaymentRow[] = await this.knex('payments')
      .where({ id: row.id, status: 'refund_pending' })
      .update({
        refund_attempts: this.knex.raw('refund_attempts + 1'),
        refund_attempted_at: this.knex.fn.now(),
      })
      .returning('*');
    if (updated && updated.refund_attempts === REFUND_ATTEMPTS_WARN) {
      this.logger.warn(
        `refund ${updated.telegram_payment_charge_id} failed ${updated.refund_attempts} times, still refund_pending`,
      );
    }
  }
}
