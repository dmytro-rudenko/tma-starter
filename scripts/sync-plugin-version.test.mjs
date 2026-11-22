import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/sync-plugin-version.mjs');

const pluginJson = {
  name: 'tma-starter',
  version: '0.0.0',
  description: 'Scaffold Telegram Mini Apps on tma-starter',
  author: { name: 'Dmytro Rudenko' },
  license: 'MIT',
  repository: 'https://github.com/dmytro-rudenko/tma-starter',
};

const skill = `---
name: new
description: Scaffold a Telegram Mini App
version: 0.4.2
---

# Body
version: 9.9.9
`;

function makeFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sync-plugin-version-'));
  mkdirSync(path.join(dir, 'packages/tma'), { recursive: true });
  mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(path.join(dir, 'skills/new'), { recursive: true });

  const corePkgText = JSON.stringify({ name: 'tma-starter', version: '1.2.3' }, null, 2) + '\n';
  writeFileSync(path.join(dir, 'packages/tma/package.json'), corePkgText);

  writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify(pluginJson, null, 2) + '\n');

  writeFileSync(path.join(dir, 'skills/new/SKILL.md'), skill);

  return { dir, corePkgText };
}

test('copies the tma-starter version into plugin.json and SKILL.md frontmatter', (t) => {
  const { dir, corePkgText } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  execFileSync(process.execPath, [script, dir], { stdio: 'pipe' });

  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8')), {
    ...pluginJson,
    version: '1.2.3',
  });

  const expectedSkill = skill.replace('version: 0.4.2', 'version: 1.2.3');
  assert.equal(readFileSync(path.join(dir, 'skills/new/SKILL.md'), 'utf8'), expectedSkill);

  assert.equal(readFileSync(path.join(dir, 'packages/tma/package.json'), 'utf8'), corePkgText);
});

test('running it twice leaves the files unchanged', (t) => {
  const { dir } = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  execFileSync(process.execPath, [script, dir], { stdio: 'pipe' });
  const plugin1 = readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8');
  const skill1 = readFileSync(path.join(dir, 'skills/new/SKILL.md'), 'utf8');

  execFileSync(process.execPath, [script, dir], { stdio: 'pipe' });
  assert.equal(readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'), plugin1);
  assert.equal(readFileSync(path.join(dir, 'skills/new/SKILL.md'), 'utf8'), skill1);
});
