import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { version } = JSON.parse(
  readFileSync(path.join(root, 'packages/tma/package.json'), 'utf8'),
);

const pluginPath = path.join(root, '.claude-plugin/plugin.json');
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
plugin.version = version;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');

const skillPath = path.join(root, 'skills/new/SKILL.md');
const skill = readFileSync(skillPath, 'utf8');
const updated = skill.replace(/^version:.*$/m, `version: ${version}`);
if (updated === skill && !/^version: /m.test(skill)) {
  throw new Error(`no version line in ${skillPath}`);
}
writeFileSync(skillPath, updated);
