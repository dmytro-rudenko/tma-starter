import type { Knex } from 'knex';
import * as tma_payments_001_payments from './tma_payments_001_payments';
import * as tma_payments_002_entitlements from './tma_payments_002_entitlements';
import * as tma_payments_003_refund_requested_by from './tma_payments_003_refund_requested_by';

const modules: Record<string, Knex.Migration> = {
  tma_payments_001_payments,
  tma_payments_002_entitlements,
  tma_payments_003_refund_requested_by,
};

export const migrations: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(modules),
  getMigrationName: (name) => name,
  getMigration: async (name) => modules[name],
};
