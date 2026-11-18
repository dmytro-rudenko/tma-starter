import { Inject, Injectable } from '@nestjs/common';
import { TMA_KNEX } from '@dmytro-rudenko/tma-nest-core';
import type { Knex } from 'knex';

export type EntitlementSource = 'subscription' | 'one_time' | 'grant';

export interface EntitlementRow {
  user_id: string | number;
  product_id: string;
  source: EntitlementSource;
  expires_at: Date | null;
  subscription_charge_id: string | null;
  canceled_at: Date | null;
  updated_at: Date;
}

export interface EntitlementView {
  productId: string;
  source: EntitlementSource;
  expiresAt: Date | null;
  canceled: boolean;
}

export function toEntitlementView(r: EntitlementRow): EntitlementView {
  return {
    productId: r.product_id,
    source: r.source,
    expiresAt: r.expires_at,
    canceled: r.canceled_at !== null,
  };
}

export function whereActive(qb: Knex.QueryBuilder, knex: Knex): Knex.QueryBuilder {
  return qb.where((w) => w.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now()));
}

@Injectable()
export class EntitlementsService {
  constructor(@Inject(TMA_KNEX) private readonly knex: Knex) {}

  async has(userId: number, productId: string): Promise<boolean> {
    return !!(await this.active(userId, productId));
  }

  async active(
    userId: number,
    productId: string,
    db: Knex | Knex.Transaction = this.knex,
  ): Promise<EntitlementRow | undefined> {
    return whereActive(db('entitlements').where({ user_id: userId, product_id: productId }), this.knex).first();
  }

  async list(userId: number): Promise<EntitlementView[]> {
    const rows: EntitlementRow[] = await whereActive(
      this.knex('entitlements').where({ user_id: userId }),
      this.knex,
    ).orderBy('product_id');
    return rows.map(toEntitlementView);
  }
}
