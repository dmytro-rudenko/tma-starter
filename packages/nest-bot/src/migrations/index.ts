import type { Knex } from 'knex';
import * as tma_bot_001_users_bot_blocked_at from './tma_bot_001_users_bot_blocked_at';

const modules: Record<string, Knex.Migration> = { tma_bot_001_users_bot_blocked_at };

export const migrations: Knex.MigrationSource<string> = {
  getMigrations: async () => Object.keys(modules),
  getMigrationName: (name) => name,
  getMigration: async (name) => modules[name],
};
