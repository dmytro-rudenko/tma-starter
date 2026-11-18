import { createHash, randomBytes } from 'crypto';
import { knex as createKnex, Knex } from 'knex';

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
  end(): Promise<void>;
}

const { Client } = require('pg') as { Client: new (opts: { connectionString: string }) => PgClient };

const TEMPLATE_LOCK = 727272;

export interface TestDatabase {
  url: string;
  knex: Knex;
  drop(): Promise<void>;
}

export function adminUrl(): string {
  return process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
}

function urlForDb(name: string): string {
  const u = new URL(adminUrl());
  u.pathname = '/' + name;
  return u.toString();
}

async function withAdmin<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function migrationsFingerprint(source: Knex.MigrationSource<unknown>): Promise<string> {
  const list = await source.getMigrations([]);
  const parts = await Promise.all(
    list.map(async (m) => {
      const migration = await source.getMigration(m);
      return [source.getMigrationName(m), migration.up.toString(), migration.down?.toString() ?? ''];
    }),
  );
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 12);
}

const readyTemplates = new Map<string, Promise<string>>();

async function buildTemplate(client: PgClient, name: string, source: Knex.MigrationSource<unknown>) {
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount) return;
  const build = `${name}_build`;
  await client.query(`DROP DATABASE IF EXISTS "${build}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${build}"`);
  const knex = createKnex({ client: 'pg', connection: urlForDb(build), pool: { min: 0, max: 1 } });
  try {
    await knex.migrate.latest({ migrationSource: source });
  } catch (err) {
    await knex.destroy();
    await client.query(`DROP DATABASE IF EXISTS "${build}" WITH (FORCE)`);
    throw err;
  }
  await knex.destroy();
  await client.query(`ALTER DATABASE "${build}" RENAME TO "${name}"`);
}

function ensureTemplate(source: Knex.MigrationSource<unknown>): Promise<string> {
  return migrationsFingerprint(source).then((hash) => {
    const name = 'tma_tpl_' + hash;
    let ready = readyTemplates.get(name);
    if (!ready) {
      ready = withAdmin(async (client) => {
        await client.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK]);
        try {
          await buildTemplate(client, name, source);
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]);
        }
        return name;
      });
      readyTemplates.set(name, ready);
      ready.catch(() => readyTemplates.delete(name));
    }
    return ready;
  });
}

export async function createTestDatabase({
  migrations,
}: {
  migrations: Knex.MigrationSource<any>;
}): Promise<TestDatabase> {
  const template = await ensureTemplate(migrations);
  const name = 'tma_t_' + randomBytes(5).toString('hex');
  await withAdmin(async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK]);
    try {
      await client.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK]);
    }
  });
  const url = urlForDb(name);
  const knex = createKnex({ client: 'pg', connection: url, pool: { min: 0, max: 10 } });
  let dropped = false;
  return {
    url,
    knex,
    drop: async () => {
      if (dropped) return;
      dropped = true;
      await knex.destroy();
      await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}
