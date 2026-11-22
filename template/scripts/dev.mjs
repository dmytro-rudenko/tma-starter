import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import testing from '@dmytro-rudenko/tma-testing';

const { devUrl, startFakeBotApi } = testing;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_DIR = fileURLToPath(new URL('../apps/api', import.meta.url));
const WEB = '@__APP_SLUG__/web';
const FAKE_BOT_PORT = 3199;
const API_PORT = 3100;
const WEB_PORT = 5173;

const envFile = `${ROOT}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const { DATABASE_URL, BOT_TOKEN } = process.env;
if (!DATABASE_URL || !BOT_TOKEN) fail(['DATABASE_URL and BOT_TOKEN must be set in .env']);

const adminIds = (process.env.ADMIN_USER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => /^\d+$/.test(s))
  .map(Number);

async function prepareDatabase() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
  } catch (err) {
    fail([
      `cannot connect to DATABASE_URL: ${err.message}`,
      'start the database and apply migrations first:',
      '  pnpm db:start && pnpm db:create && pnpm db:migrate',
    ]);
  }
  try {
    const { rows } = await client.query("select to_regclass('public.app_settings') as t");
    if (!rows[0].t) fail(['the database has no tables yet, run `pnpm db:migrate`']);
    if (adminIds.length > 0) {
      const { rowCount } = await client.query(
        `insert into app_settings (key, value) values ('payments.test_users', $1::jsonb)
         on conflict (key) do nothing`,
        [JSON.stringify(adminIds)],
      );
      if (rowCount) console.log(`payments.test_users = ${JSON.stringify(adminIds)}`);
    }
  } finally {
    await client.end();
  }
}

await prepareDatabase();

const fakeBot = await startFakeBotApi({ port: FAKE_BOT_PORT });
const children = [];
let stopping = false;

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
  await fakeBot.close();
  process.exit(code);
}

function run(name, cmd, args, opts = {}) {
  // Each child leads its own process group so stop() also reaches the grandchildren
  // (nest start's app process); stdin stays closed because a background group reading
  // the terminal would be stopped by SIGTTIN.
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true,
    ...opts,
  });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`${name} exited with code ${code}`);
    void stop(code ?? 1);
  });
  children.push(child);
  return child;
}

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));

run('api', 'pnpm', ['exec', 'nest', 'start', '--watch', '--preserveWatchOutput'], {
  cwd: API_DIR,
  env: { ...process.env, BOT_API_ROOT: fakeBot.url, PORT: String(API_PORT) },
});
run('vite', 'pnpm', ['--filter', WEB, 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'], {
  cwd: ROOT,
});

const user = { id: adminIds[0] ?? 1, first_name: 'Dev' };
const url = devUrl({ baseUrl: `http://localhost:${WEB_PORT}`, user, botToken: BOT_TOKEN });
console.log(`\nfake Bot API  ${fakeBot.url}`);
console.log(`API           http://127.0.0.1:${API_PORT}`);
console.log(`Mini App      ${url}\n`);
if (adminIds.length === 0) console.log('ADMIN_USER_IDS is empty: the dev user is not an admin');
