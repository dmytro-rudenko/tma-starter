import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/changeset-check.sh');

function git(dir, ...args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'pipe' });
}

function write(dir, file, text) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

function makeRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'changeset-check-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, '.changeset/README.md', '# Changesets\n');
  write(dir, '.changeset/old-change.md', "---\n'@dmytro-rudenko/tma-nest-core': patch\n---\n\nOld\n");
  write(dir, 'packages/nest-core/src/index.ts', 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'branch', 'base');
  return dir;
}

function check(dir) {
  return spawnSync('bash', [script, 'base'], { cwd: dir, encoding: 'utf8' });
}

function commitAll(dir) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
}

test('passes when nothing under packages/, skills/ or template/ changed', (t) => {
  const dir = makeRepo(t);
  write(dir, 'docs/notes.md', 'notes\n');
  commitAll(dir);
  assert.equal(check(dir).status, 0);
});

test('fails when a package changed without a changeset', (t) => {
  const dir = makeRepo(t);
  write(dir, 'packages/nest-core/src/index.ts', 'export const a = 1;\n');
  commitAll(dir);
  const res = check(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /no \.changeset\/\*\.md/);
});

test('passes when a package changed together with a new changeset', (t) => {
  const dir = makeRepo(t);
  write(dir, 'packages/nest-core/src/index.ts', 'export const a = 1;\n');
  write(dir, '.changeset/new-change.md', "---\n'@dmytro-rudenko/tma-nest-core': patch\n---\n\nNew\n");
  commitAll(dir);
  assert.equal(check(dir).status, 0);
});

test('passes when a package changed together with an edited changeset', (t) => {
  const dir = makeRepo(t);
  write(dir, 'packages/nest-core/src/index.ts', 'export const a = 1;\n');
  write(dir, '.changeset/old-change.md', "---\n'@dmytro-rudenko/tma-nest-core': minor\n---\n\nOld\n");
  commitAll(dir);
  assert.equal(check(dir).status, 0);
});

test('fails when the only changeset change is deleting an existing one', (t) => {
  const dir = makeRepo(t);
  write(dir, 'packages/nest-core/src/index.ts', 'export const a = 1;\n');
  rmSync(path.join(dir, '.changeset/old-change.md'));
  commitAll(dir);
  assert.equal(check(dir).status, 1);
});

test('editing .changeset/README.md does not count as a changeset', (t) => {
  const dir = makeRepo(t);
  write(dir, 'packages/nest-core/src/index.ts', 'export const a = 1;\n');
  write(dir, '.changeset/README.md', '# Changesets!\n');
  commitAll(dir);
  assert.equal(check(dir).status, 1);
});
