import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { apiError, TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import { BotService } from '@dmytro-rudenko/tma-nest-bot';
import type { StarTransaction } from 'grammy/types';
import type { Knex } from 'knex';

export const RECONCILE_LIMIT = 100;

export interface MissingPayment {
  chargeId: string;
  userId: number;
  amountStars: number;
  invoicePayload: string | null;
  date: Date;
}

export interface ReconcileReport {
  offset: number;
  checked: number;
  invoicePayments: number;
  missing: MissingPayment[];
  nextOffset: number | null;
}

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    @Inject(TMA_KNEX) private readonly knex: Knex,
    private readonly bots: BotService,
  ) {}

  async reconcile(offset = 0): Promise<ReconcileReport> {
    let transactions: StarTransaction[];
    try {
      ({ transactions } = await this.bots.bot.api.getStarTransactions({ offset, limit: RECONCILE_LIMIT }));
    } catch (err) {
      this.logger.error(`getStarTransactions failed: ${String(err)}`);
      throw apiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_PROVIDER_UNAVAILABLE');
    }
    const invoices = transactions.filter(
      (tx) => tx.source?.type === 'user' && tx.source.transaction_type === 'invoice_payment',
    );
    const known = new Set<string>(
      invoices.length === 0
        ? []
        : await this.knex('payments')
            .whereIn(
              'telegram_payment_charge_id',
              invoices.map((tx) => tx.id),
            )
            .pluck('telegram_payment_charge_id'),
    );
    const missing = invoices
      .filter((tx) => !known.has(tx.id))
      .map((tx): MissingPayment => {
        const source = tx.source?.type === 'user' ? tx.source : undefined;
        return {
          chargeId: tx.id,
          userId: source?.user.id ?? 0,
          amountStars: tx.amount,
          invoicePayload: source?.invoice_payload ?? null,
          date: new Date(tx.date * 1000),
        };
      });
    return {
      offset,
      checked: transactions.length,
      invoicePayments: invoices.length,
      missing,
      nextOffset: transactions.length >= RECONCILE_LIMIT ? offset + transactions.length : null,
    };
  }
}
