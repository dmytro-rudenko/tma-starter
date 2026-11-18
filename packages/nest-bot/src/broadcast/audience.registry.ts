import { HttpStatus, Injectable } from '@nestjs/common';
import { apiError } from '@dmytro-rudenko/tma-nest-core';
import type { Knex } from 'knex';

export interface BroadcastAudienceFilter {
  key: string;
  label: string;
  apply(qb: Knex.QueryBuilder, value: unknown): unknown;
}

export interface BroadcastAudienceFilterView {
  key: string;
  label: string;
}

@Injectable()
export class BroadcastAudienceRegistry {
  private readonly filters = new Map<string, BroadcastAudienceFilter>();

  register(filter: BroadcastAudienceFilter): void {
    if (this.filters.has(filter.key)) {
      throw new Error(`Broadcast audience filter "${filter.key}" is already registered`);
    }
    this.filters.set(filter.key, filter);
  }

  list(): BroadcastAudienceFilterView[] {
    return [...this.filters.values()].map(({ key, label }) => ({ key, label }));
  }

  apply(qb: Knex.QueryBuilder, filters: Record<string, unknown> = {}): Knex.QueryBuilder {
    const entries = Object.entries(filters);
    for (const [key] of entries) {
      if (!this.filters.has(key)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'VALIDATION', `Unknown audience filter: ${key}`);
      }
    }
    for (const [key, value] of entries) this.filters.get(key)!.apply(qb, value);
    return qb;
  }
}
