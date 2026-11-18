import type { Knex } from 'knex';
import * as tma_core_001_init from './tma_core_001_init';

const modules: Record<string, Knex.Migration> = { tma_core_001_init };

export const migrations: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(modules),
  getMigrationName: (name) => name,
  getMigration: async (name) => modules[name],
};

export { composeMigrations } from './compose';
