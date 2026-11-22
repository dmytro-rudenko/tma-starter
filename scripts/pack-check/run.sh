#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/pack-check"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
pnpm -r build
mkdir -p "$TMP/tarballs" "$TMP/fixture"
pnpm -r exec pnpm pack --pack-destination "$TMP/tarballs"

cp "$HERE/check.ts" "$TMP/fixture/check.ts"
ROOT="$ROOT" TMP="$TMP" HERE="$HERE" node --input-type=module <<'JS'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const { ROOT, TMP, HERE } = process.env;
const check = readFileSync(path.join(HERE, 'check.ts'), 'utf8');
const fixture = JSON.parse(readFileSync(path.join(HERE, 'package.json'), 'utf8'));
const tarballs = readdirSync(path.join(TMP, 'tarballs'));
const overrides = {};

for (const dir of readdirSync(path.join(ROOT, 'packages'))) {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
  const tarball = `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`;
  if (!tarballs.includes(tarball)) throw new Error(`pack-check: ${tarball} was not packed`);
  const spec = `file:${path.join(TMP, 'tarballs', tarball)}`;
  fixture.dependencies[pkg.name] = spec;
  overrides[pkg.name] = spec;
  for (const subpath of Object.keys(pkg.exports ?? {})) {
    const specifier = path.posix.join(pkg.name, subpath);
    if (!check.includes(`'${specifier}'`)) throw new Error(`pack-check: check.ts does not import ${specifier}`);
  }
}

writeFileSync(path.join(TMP, 'fixture/package.json'), JSON.stringify(fixture, null, 2));
writeFileSync(path.join(TMP, 'fixture/pnpm-workspace.yaml'), `overrides:\n${Object.entries(overrides).map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`);
JS

cd "$TMP/fixture"
pnpm install --no-frozen-lockfile --ignore-scripts
pnpm exec tsc --noEmit --strict --skipLibCheck --target es2022 --lib es2022,dom --module esnext --moduleResolution bundler --resolveJsonModule --esModuleInterop --types node check.ts

echo "pack-check OK"
