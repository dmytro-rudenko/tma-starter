import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env)');
  process.exit(2);
}

const target = new URL(url);
const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!name) {
  console.error('DATABASE_URL has no database name');
  process.exit(2);
}
const admin = new URL(url);
admin.pathname = '/postgres';

const client = new pg.Client({ connectionString: admin.toString() });
try {
  await client.connect();
} catch (err) {
  console.error(`cannot connect to ${admin.host}: ${err.message}`);
  console.error('start the local database with `pnpm db:start`');
  process.exit(1);
}
try {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (rowCount) {
    console.log(`database ${name} already exists`);
  } else {
    await client.query(`create database "${name.replace(/"/g, '""')}"`);
    console.log(`database ${name} created`);
  }
} finally {
  await client.end();
}
