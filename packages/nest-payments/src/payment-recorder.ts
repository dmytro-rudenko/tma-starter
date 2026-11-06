import type { TgUser, UsersService } from '@dmytro-rudenko/tma-nest-core';
import type { Knex } from 'knex';
import type { PaymentRow, PaymentStatus, Product } from './product';

export type Recurrence = 'none' | 'first' | 'renewal';

export interface PaidInput {
  product: Product;
  targetId?: string;
  payer: TgUser | number;
  amountStars: number;
  invoicePayload: string;
  chargeId: string;
  recurrence: Recurrence;
  expiresAt: Date | null;
  subscriptionChargeId: string | null;
}

export type PaidOutcome =
  | { kind: 'duplicate' }
  | { kind: 'refund'; payment: PaymentRow }
  | { kind: 'settled'; payment: PaymentRow; renewal: boolean };

type Recorded = { kind: 'inserted'; payment: PaymentRow } | Exclude<PaidOutcome, { kind: 'settled' }>;

export class PaymentRecorder {
  constructor(private readonly users: UsersService) {}

  async settle(trx: Knex.Transaction, input: PaidInput): Promise<PaidOutcome> {
    const { product, targetId } = input;
    const payerId = typeof input.payer === 'number' ? input.payer : input.payer.id;
    let accept = true;
    if (product.kind === 'one_time' && targetId !== undefined && product.lock) {
      accept = (await product.lock(trx, targetId)) != null;
    }
    if (typeof input.payer !== 'number') await this.users.upsert(input.payer, trx);
    if (accept && product.kind === 'one_time' && product.validate) {
      accept = await product.validate({ userId: payerId, targetId, trx });
    }

    const recorded = await this.record(trx, {
      payer_id: payerId,
      product_id: product.id,
      target_id: targetId ?? null,
      amount_stars: input.amountStars,
      invoice_payload: input.invoicePayload,
      telegram_payment_charge_id: input.chargeId,
      is_recurring: input.recurrence !== 'none',
      subscription_expires_at: input.expiresAt,
      status: accept ? 'paid' : 'refund_pending',
    });
    if (recorded.kind !== 'inserted') return recorded;
    const payment = recorded.payment;
    if (!accept) return { kind: 'refund', payment };

    if (input.recurrence === 'first') {
      await trx('entitlements')
        .insert({
          user_id: payerId,
          product_id: product.id,
          source: 'subscription',
          expires_at: input.expiresAt,
          subscription_charge_id: input.subscriptionChargeId,
          canceled_at: null,
          updated_at: trx.fn.now(),
        })
        .onConflict(['user_id', 'product_id'])
        .merge();
    } else if (input.recurrence === 'renewal') {
      await this.extend(trx, payerId, input);
    } else {
      if (targetId === undefined && !product.repeatable) {
        await trx('entitlements')
          .insert({
            user_id: payerId,
            product_id: product.id,
            source: 'one_time',
            expires_at: null,
            subscription_charge_id: null,
            canceled_at: null,
            updated_at: trx.fn.now(),
          })
          .onConflict(['user_id', 'product_id'])
          .merge();
      }
      await product.settle?.(trx, payment);
    }
    return { kind: 'settled', payment, renewal: input.recurrence === 'renewal' };
  }

  private async extend(trx: Knex.Transaction, payerId: number, input: PaidInput): Promise<void> {
    const updated = await trx('entitlements')
      .where({ user_id: payerId, product_id: input.product.id, source: 'subscription' })
      .update({
        expires_at: trx.raw('greatest(expires_at, ?::timestamptz)', [input.expiresAt]),
        updated_at: trx.fn.now(),
      });
    if (updated > 0) return;
    const first = await trx('payments')
      .where({ payer_id: payerId, invoice_payload: input.invoicePayload, is_recurring: true })
      .orderBy('created_at', 'asc')
      .first('telegram_payment_charge_id');
    await trx('entitlements')
      .insert({
        user_id: payerId,
        product_id: input.product.id,
        source: 'subscription',
        expires_at: input.expiresAt,
        subscription_charge_id: first?.telegram_payment_charge_id ?? input.chargeId,
        canceled_at: null,
        updated_at: trx.fn.now(),
      })
      .onConflict(['user_id', 'product_id'])
      .ignore();
  }

  private async record(
    trx: Knex.Transaction,
    row: Omit<PaymentRow, 'id' | 'refunded_at' | 'created_at' | 'status'> & { status: PaymentStatus },
  ): Promise<Recorded> {
    const [inserted]: PaymentRow[] = await trx('payments')
      .insert(row)
      .onConflict()
      .ignore()
      .returning('*');
    if (inserted) return { kind: 'inserted', payment: inserted };
    const seen: PaymentRow | undefined = await trx('payments')
      .where({ telegram_payment_charge_id: row.telegram_payment_charge_id })
      .first();
    if (seen) return seen.status === 'refund_pending' ? { kind: 'refund', payment: seen } : { kind: 'duplicate' };
    // The partial UNIQUE on one-time payloads would reject a second row with the same payload.
    const [again]: PaymentRow[] = await trx('payments')
      .insert({
        ...row,
        invoice_payload: `${row.invoice_payload}#${row.telegram_payment_charge_id}`,
        status: 'refund_pending',
      })
      .onConflict()
      .ignore()
      .returning('*');
    return again ? { kind: 'refund', payment: again } : { kind: 'duplicate' };
  }
}
