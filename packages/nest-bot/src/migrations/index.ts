import type { Knex } from 'knex';
import * as tma_bot_001_users_bot_blocked_at from './tma_bot_001_users_bot_blocked_at';
import * as tma_bot_002_broadcasts from './tma_bot_002_broadcasts';

const modules: Record<string, Knex.Migration> = {
  tma_bot_001_users_bot_blocked_at,
  tma_bot_002_broadcasts,
};

export const migrations: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(modules),
  getMigrationName: (name) => name,
  getMigration: async (name) => modules[name],
};
