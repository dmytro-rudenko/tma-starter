import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  AdminRightsService,
  apiError,
  AppSettingsService,
  AuditService,
  RealtimeService,
  TMA_KNEX,
  UsersService,
} from '@dmytro-rudenko/tma-nest-core';
import {
  BotCopyEntries,
  BotLang,
  BotService,
  DEFAULT_BOT_COPY,
  escapeHtml,
  langOf,
  NotificationsService,
} from '@dmytro-rudenko/tma-nest-bot';
import { randomUUID } from 'crypto';
import type { Context, Filter } from 'grammy';
import type { PreCheckoutQuery } from 'grammy/types';
import type { Knex } from 'knex';
import { EntitlementRow, EntitlementsService } from './entitlements.service';
import { TmaPaymentsErrorCode } from './error-codes';
import { makePayload, parsePayload } from './invoice-payload';
import {
  ResolvedTmaPaymentsOptions,
  SUBSCRIPTION_PERIOD_SEC,
  TMA_PAYMENTS_OPTIONS,
} from './options';
import { PaidOutcome, PaymentRecorder, Recurrence } from './payment-recorder';
import type { PaymentRow, Product, ProductKind } from './product';
import { ProductRegistry } from './product.registry';
import { PAYMENTS_TEST_USERS } from './settings';

const REFUND_RETRY_BATCH = 20;

export type InvoiceResult = { invoiceLink: string } | { settled: true };

export interface ProductView {
  id: string;
  kind: ProductKind;
  repeatable: boolean;
  priceStars: number;
  title: string;
  description: string;
}

function alreadyRefunded(err: unknown): boolean {
  const e = err as { description?: unknown; message?: unknown } | null;
  return /CHARGE_ALREADY_REFUNDED/.test(
    `${String(e?.description ?? '')} ${String(e?.message ?? '')}`,
  );
}

export function heldCode(
  product: Product,
  targetId: string | undefined,
  active: EntitlementRow | undefined,
): TmaPaymentsErrorCode | null {
  if (!active) return null;
  if (product.kind === 'subscription') return active.canceled_at === null ? 'ALREADY_SUBSCRIBED' : null;
  return targetId === undefined && !product.repeatable ? 'ALREADY_OWNED' : null;
}

@Injectable()
export class PaymentsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly recorder: PaymentRecorder;
  private timer?: ReturnType<typeof setInterval>;
  private retrying?: Promise<void>;

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    @Inject(TMA_PAYMENTS_OPTIONS) private readonly opts: ResolvedTmaPaymentsOptions,
    private readonly registry: ProductRegistry,
    private readonly entitlements: EntitlementsService,
    private readonly bots: BotService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly settings: AppSettingsService,
    private readonly rights: AdminRightsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {
    this.recorder = new PaymentRecorder(users);
  }

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

  async products(userId: number, targetId?: string): Promise<ProductView[]> {
    const lang = await this.langOf(userId);
    return Promise.all(
      this.registry.all().map(async (p) => ({
        id: p.id,
        kind: p.kind,
        repeatable: !!p.repeatable,
        priceStars: await p.priceStars({ userId, targetId, trx: this.knex }),
        title: p.title(lang),
        description: p.description(lang),
      })),
    );
  }

  async createInvoiceLink(userId: number, productId: string, targetId?: string): Promise<InvoiceResult> {
    const product = this.registry.get(productId);
    if (!product) throw apiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND');
    let payload: string;
    try {
      payload = makePayload(product.id, targetId);
    } catch (err) {
      throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', err instanceof Error ? err.message : String(err));
    }
    const ctx = { userId, targetId, trx: this.knex };
    if (product.validate && !(await product.validate(ctx))) {
      throw apiError(HttpStatus.CONFLICT, 'PRODUCT_UNAVAILABLE');
    }
    const held = heldCode(product, targetId, await this.entitlements.active(userId, product.id));
    if (held) throw apiError(HttpStatus.CONFLICT, held);

    if (await this.isTestUser(userId)) return this.testSettle(userId, product, payload, targetId);

    const amount = await product.priceStars(ctx);
    const lang = await this.langOf(userId);
    const title = product.title(lang);
    try {
      const invoiceLink = await this.bots.bot.api.createInvoiceLink(
        title,
        product.description(lang),
        payload,
        '',
        'XTR',
        [{ label: title, amount }],
        product.kind === 'subscription' ? { subscription_period: SUBSCRIPTION_PERIOD_SEC } : {},
      );
      return { invoiceLink };
    } catch (err) {
      this.logger.error(`createInvoiceLink ${product.id} for ${userId} failed: ${String(err)}`);
      throw apiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
  }

  async preCheckout(ctx: Filter<Context, 'pre_checkout_query'>): Promise<void> {
    const q = ctx.preCheckoutQuery;
    const ok = await this.isPayable(q).catch((err: unknown) => {
      this.logger.warn(`pre_checkout ${q.id} check failed: ${String(err)}`);
      return false;
    });
    if (ok) {
      await ctx.api.answerPreCheckoutQuery(q.id, true);
      return;
    }
    const lang = this.bots.langFor(ctx);
    await ctx.api.answerPreCheckoutQuery(q.id, false, {
      error_message: this.bots.copy[lang].payRejected ?? DEFAULT_BOT_COPY[lang].payRejected,
    });
  }

  async onPaid(ctx: Filter<Context, 'message:successful_payment'>): Promise<void> {
    const sp = ctx.message.successful_payment;
    const from = ctx.message.from;
    const chargeId = sp.telegram_payment_charge_id;
    const parsed = parsePayload(sp.invoice_payload, this.registry.ids());
    const product = parsed && this.registry.get(parsed.productId);
    if (!parsed || !product) {
      this.logger.error(`successful_payment ${chargeId} has an unknown payload; refunding`);
      await this.refundStars(from.id, chargeId);
      return;
    }
    const recurrence: Recurrence =
      product.kind === 'one_time'
        ? 'none'
        : sp.is_recurring && !sp.is_first_recurring
          ? 'renewal'
          : 'first';
    const expiresAt =
      product.kind === 'subscription'
        ? new Date(
            (sp.subscription_expiration_date ?? Math.floor(Date.now() / 1000) + SUBSCRIPTION_PERIOD_SEC) *
              1000,
          )
        : null;
    const outcome = await this.knex.transaction((trx) =>
      this.recorder.settle(trx, {
        product,
        targetId: parsed.targetId,
        payer: from,
        amountStars: sp.total_amount,
        invoicePayload: sp.invoice_payload,
        chargeId,
        recurrence,
        expiresAt,
        subscriptionChargeId: recurrence === 'first' ? chargeId : null,
      }),
    );
    await this.afterCommit(outcome, product);
  }

  async retryPendingRefunds(): Promise<void> {
    if (this.retrying) return this.retrying;
    this.retrying = (async () => {
      try {
        const rows: PaymentRow[] = await this.knex('payments')
          .where({ status: 'refund_pending' })
          .orderBy('created_at')
          .limit(REFUND_RETRY_BATCH);
        for (const row of rows) await this.refundPending(row).catch(() => undefined);
      } catch (err) {
        this.logger.error(`refund retry failed: ${String(err)}`);
      } finally {
        this.retrying = undefined;
      }
    })();
    return this.retrying;
  }

  private async testSettle(
    userId: number,
    product: Product,
    payload: string,
    targetId: string | undefined,
  ): Promise<InvoiceResult> {
    const subscription = product.kind === 'subscription';
    const outcome = await this.knex.transaction(async (trx) => {
      const result = await this.recorder.settle(trx, {
        product,
        targetId,
        payer: userId,
        amountStars: 0,
        invoicePayload: payload,
        chargeId: `test:${randomUUID()}`,
        recurrence: subscription ? 'first' : 'none',
        expiresAt: subscription ? new Date(Date.now() + SUBSCRIPTION_PERIOD_SEC * 1000) : null,
        subscriptionChargeId: null,
      });
      if (result.kind !== 'settled') throw apiError(HttpStatus.CONFLICT, 'PRODUCT_UNAVAILABLE');
      await this.audit.record(trx, {
        actorId: userId,
        action: 'payment.test_settle',
        targetType: 'payment',
        targetId: result.payment.id,
        meta: { productId: product.id, targetId: targetId ?? null },
      });
      return result;
    });
    await this.afterCommit(outcome, product);
    return { settled: true };
  }

  private async afterCommit(outcome: PaidOutcome, product: Product): Promise<void> {
    if (outcome.kind === 'refund') {
      await this.refundPending(outcome.payment);
      return;
    }
    if (outcome.kind !== 'settled') return;
    const { payment } = outcome;
    const payerId = Number(payment.payer_id);
    this.realtime.emitToUser(payerId, 'payment.settled', {
      productId: product.id,
      paymentId: payment.id,
    });
    void this.notify(payerId, (copy, lang) => {
      const title = escapeHtml(product.title(lang));
      if (!outcome.renewal) return copy.paymentReceived?.(title) ?? null;
      const until = (payment.subscription_expires_at ?? new Date()).toISOString().slice(0, 10);
      return copy.subscriptionRenewed?.(title, until) ?? null;
    });
  }

  private async refundPending(payment: PaymentRow): Promise<void> {
    const payerId = Number(payment.payer_id);
    try {
      await this.refundStars(payerId, payment.telegram_payment_charge_id);
    } catch (err) {
      this.logger.error(
        `refund ${payment.telegram_payment_charge_id} failed, stays refund_pending: ${String(err)}`,
      );
      throw err;
    }
    const product = this.registry.get(payment.product_id);
    const refunded = await this.knex.transaction(async (trx) => {
      const [row]: PaymentRow[] = await trx('payments')
        .where({ id: payment.id, status: 'refund_pending' })
        .update({ status: 'refunded', refunded_at: trx.fn.now() })
        .returning('*');
      if (row) await product?.onRefund?.(trx, row);
      return row;
    });
    if (refunded && product) {
      void this.notify(payerId, (copy, lang) =>
        copy.paymentRefunded?.(escapeHtml(product.title(lang)), refunded.amount_stars) ?? null,
      );
    }
  }

  private async refundStars(payerId: number, chargeId: string): Promise<void> {
    try {
      await this.bots.bot.api.refundStarPayment(payerId, chargeId);
    } catch (err) {
      if (!alreadyRefunded(err)) throw err;
    }
  }

  private async isPayable(q: PreCheckoutQuery): Promise<boolean> {
    if (q.currency !== 'XTR') return false;
    const parsed = parsePayload(q.invoice_payload, this.registry.ids());
    const product = parsed && this.registry.get(parsed.productId);
    if (!parsed || !product) return false;
    if (await this.users.isBlocked(q.from.id)) return false;
    const ctx = { userId: q.from.id, targetId: parsed.targetId, trx: this.knex };
    if (product.validate && !(await product.validate(ctx))) return false;
    if (heldCode(product, parsed.targetId, await this.entitlements.active(q.from.id, product.id))) {
      return false;
    }
    return q.total_amount === (await product.priceStars(ctx));
  }

  private async isTestUser(userId: number): Promise<boolean> {
    const testUsers = await this.settings.get<number[]>(PAYMENTS_TEST_USERS.key);
    return testUsers.includes(userId) && (await this.rights.isAdmin(userId));
  }

  private async langOf(userId: number): Promise<BotLang> {
    const user = await this.users.get(userId);
    return langOf(user?.language ?? user?.languageCode);
  }

  private async notify(
    userId: number,
    render: (copy: BotCopyEntries, lang: BotLang) => string | null,
  ): Promise<void> {
    try {
      const lang = await this.langOf(userId);
      const text = render(this.bots.copy[lang], lang);
      if (text !== null) await this.notifications.send(userId, () => text);
    } catch (err) {
      this.logger.warn(`notify ${userId} failed: ${String(err)}`);
    }
  }
}
