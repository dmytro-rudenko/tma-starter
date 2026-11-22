import { readdirSync } from 'fs';
import { join } from 'path';
import type { Knex } from 'knex';
import { migrations as botMigrations } from '@pctea/tma-nest-bot';
import { composeMigrations, migrations as coreMigrations } from '@pctea/tma-nest-core';
import { migrations as paymentsMigrations } from '@pctea/tma-nest-payments';
import { createKnexConnection } from './knex';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const MIGRATION_FILE = /^(?!.*\.d\.ts$)(.+)\.(ts|js)$/;

function appMigrationFiles(): Map<string, string> {
  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw err;
  }
  const byName = new Map<string, string>();
  for (const file of files.sort()) {
    const match = MIGRATION_FILE.exec(file);
    if (match) byName.set(match[1], join(MIGRATIONS_DIR, file));
  }
  return byName;
}

const appMigrations: Knex.MigrationSource<string> = {
  getMigrations: async () => [...appMigrationFiles().keys()],
  getMigrationName: (name) => name,
  getMigration: async (name) => require(appMigrationFiles().get(name)!) as Knex.Migration,
};

export const migrations: Knex.MigrationSource<unknown> = composeMigrations(
  coreMigrations,
  botMigrations,
  paymentsMigrations,
  appMigrations,
);

async function main(command: string | undefined): Promise<void> {
  if (command !== 'latest' && command !== 'rollback') {
    console.error('usage: migrate.js latest|rollback');
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(2);
  }
  const knex = createKnexConnection(url);
  try {
    const [batch, names] = await knex.migrate[command]({ migrationSource: migrations });
    console.log(`migrate ${command}: batch ${batch}, ${names.length} migration(s)`);
    for (const name of names) console.log(`  ${name}`);
  } finally {
    await knex.destroy();
  }
}

if (require.main === module) {
  main(process.argv[2]).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
