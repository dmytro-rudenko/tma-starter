import type { Knex } from 'knex';
import * as tma_payments_001_payments from './tma_payments_001_payments';
import * as tma_payments_002_entitlements from './tma_payments_002_entitlements';

const modules: Record<string, Knex.Migration> = {
  tma_payments_001_payments,
  tma_payments_002_entitlements,
};

export const migrations: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(modules),
  getMigrationName: (name) => name,
  getMigration: async (name) => modules[name],
};
