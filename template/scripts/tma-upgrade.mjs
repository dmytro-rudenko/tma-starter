import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PREFIX = '@dmytro-rudenko/tma-';
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const wanted = process.argv[2] ?? 'latest';

function resolveVersion() {
  try {
    const out = execFileSync(
      'pnpm',
      ['view', `${PREFIX}nest-core@${wanted}`, 'version', '--json'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const viewed = out.trim() ? JSON.parse(out) : null;
    return Array.isArray(viewed) ? viewed[viewed.length - 1] : viewed;
  } catch {
    return null;
  }
}

const version = resolveVersion();
if (typeof version !== 'string' || version === '') {
  console.error(`no ${PREFIX}* version matches "${wanted}"`);
  process.exit(1);
}

const manifests = [
  `${ROOT}package.json`,
  ...readdirSync(`${ROOT}apps`)
    .map((dir) => `${ROOT}apps/${dir}/package.json`)
    .filter((file) => existsSync(file)),
];

const pin = (deps) => {
  if (!deps) return;
  for (const name of Object.keys(deps)) if (name.startsWith(PREFIX)) deps[name] = version;
};

for (const file of manifests) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const field of FIELDS) pin(pkg[field]);
  pin(pkg.pnpm?.overrides);
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`${PREFIX}* → ${version}`);

const install = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
process.exit(install.status ?? 1);
