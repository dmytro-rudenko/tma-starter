import type { Knex } from 'knex';

export type ProductKind = 'one_time' | 'subscription';
export type PaymentStatus = 'paid' | 'refund_pending' | 'refunded';

export interface PaymentRow {
  id: string;
  payer_id: string | number;
  product_id: string;
  target_id: string | null;
  amount_stars: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  is_recurring: boolean;
  subscription_expires_at: Date | null;
  status: PaymentStatus;
  refunded_at: Date | null;
  created_at: Date;
}

export interface ProductContext {
  userId: number;
  targetId?: string;
  trx: Knex;
}

export interface Product {
  id: string;
  kind: ProductKind;
  priceStars(ctx: ProductContext): number | Promise<number>;
  title(lang: 'uk' | 'en'): string;
  description(lang: 'uk' | 'en'): string;
  validate?(ctx: ProductContext): boolean | Promise<boolean>;
  lock?(trx: Knex.Transaction, targetId: string): Promise<unknown | null>;
  settle?(trx: Knex.Transaction, payment: PaymentRow): Promise<void>;
  onRefund?(trx: Knex.Transaction, payment: PaymentRow): Promise<void>;
  repeatable?: boolean;
}
