#!/usr/bin/env node
import { spawnSync, SpawnSyncOptions } from 'child_process';
import { chmodSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { delimiter, join } from 'path';

const PORT = 54329;
const DATA_DIR = join(homedir(), '.cache', 'tma-test-pg', '16');
const LOG_FILE = join(DATA_DIR, 'server.log');
const SOCKET_DIR = '/tmp';
const LOCALE = process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function findPgBin(): string | undefined {
  const fromPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const candidates = [
    ...fromPath,
    '/usr/lib/postgresql/16/bin',
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/opt/postgresql@16/bin',
  ];
  return candidates.find((dir) => existsSync(join(dir, 'pg_ctl')));
}

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}) {
  const [file, argv] = isRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args];
  return spawnSync(file, argv, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
}

function ensureInit(pgBin: string): void {
  if (existsSync(join(DATA_DIR, 'PG_VERSION'))) return;
  mkdirSync(DATA_DIR, { recursive: true });
  if (isRoot) spawnSync('chown', ['postgres:postgres', DATA_DIR], { stdio: 'inherit' });
  chmodSync(DATA_DIR, 0o700);
  const res = run(join(pgBin, 'initdb'), [
    '-D',
    DATA_DIR,
    '-U',
    'postgres',
    '--auth=trust',
    '--encoding=UTF8',
    `--locale=${LOCALE}`,
  ]);
  if (res.status !== 0) {
    console.error('tma-test-pg: initdb failed');
    process.exit(1);
  }
}

function isRunning(pgBin: string): boolean {
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) return false;
  return run(join(pgBin, 'pg_ctl'), ['-D', DATA_DIR, 'status'], { stdio: 'ignore' }).status === 0;
}

function main(): number {
  const command = process.argv[2];
  if (command !== 'start' && command !== 'stop' && command !== 'status') {
    console.error('usage: tma-test-pg start|stop|status');
    return 2;
  }
  const pgBin = findPgBin();
  if (!pgBin) {
    console.error('tma-test-pg: pg_ctl not found');
    return 1;
  }
  const pgCtl = join(pgBin, 'pg_ctl');

  if (command === 'start') {
    ensureInit(pgBin);
    if (isRunning(pgBin)) {
      console.log(`tma-test-pg: already running on 127.0.0.1:${PORT}`);
      return 0;
    }
    const res = run(pgCtl, [
      '-D',
      DATA_DIR,
      '-l',
      LOG_FILE,
      '-w',
      '-o',
      `-p ${PORT} -c listen_addresses=127.0.0.1 -k ${SOCKET_DIR} -c fsync=off -c synchronous_commit=off`,
      'start',
    ]);
    if (res.status !== 0) {
      console.error(`tma-test-pg: start failed, see ${LOG_FILE}`);
      return 1;
    }
    console.log(`tma-test-pg: started on 127.0.0.1:${PORT}`);
    return 0;
  }

  if (command === 'stop') {
    if (!isRunning(pgBin)) {
      console.log('tma-test-pg: not running');
      return 0;
    }
    const res = run(pgCtl, ['-D', DATA_DIR, '-w', '-m', 'fast', 'stop']);
    if (res.status !== 0) return 1;
    console.log('tma-test-pg: stopped');
    return 0;
  }

  if (isRunning(pgBin)) {
    console.log('running');
    return 0;
  }
  console.log('stopped');
  return 3;
}

process.exit(main());
