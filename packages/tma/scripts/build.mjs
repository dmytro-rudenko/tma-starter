import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
for (const project of ['tsconfig.cjs.json', 'tsconfig.esm.json']) {
  execFileSync(process.execPath, [tsc, '-p', project], { cwd: root, stdio: 'inherit' });
}
writeFileSync(new URL('../dist/esm/package.json', import.meta.url), '{\n  "type": "module"\n}\n');
