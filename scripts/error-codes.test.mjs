import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const { TMA_CORE_ERROR_CODES } = require(path.join(root, 'packages/nest-core/dist/index.js'));
const { TMA_BOT_ERROR_CODES } = require(path.join(root, 'packages/nest-bot/dist/index.js'));
const { TMA_PAYMENTS_ERROR_CODES } = require(path.join(root, 'packages/nest-payments/dist/index.js'));
const { TMA_ERROR_CODES } = await import(pathToFileURL(path.join(root, 'packages/web/dist/index.js')).href);

test('every nest-* package exports a non-empty error code array', () => {
  for (const codes of [TMA_CORE_ERROR_CODES, TMA_BOT_ERROR_CODES, TMA_PAYMENTS_ERROR_CODES]) {
    assert.ok(Array.isArray(codes));
    assert.ok(codes.length > 0);
  }
});

test('TMA_ERROR_CODES in web has no duplicates', () => {
  assert.ok(Array.isArray(TMA_ERROR_CODES));
  assert.equal(new Set(TMA_ERROR_CODES).size, TMA_ERROR_CODES.length);
});

test('TMA_ERROR_CODES in web equals the union of the nest-* error codes', () => {
  const union = new Set([...TMA_CORE_ERROR_CODES, ...TMA_BOT_ERROR_CODES, ...TMA_PAYMENTS_ERROR_CODES]);
  const web = new Set(TMA_ERROR_CODES);
  assert.deepEqual(
    { missingInWeb: [...union].filter((c) => !web.has(c)).sort(), extraInWeb: [...web].filter((c) => !union.has(c)).sort() },
    { missingInWeb: [], extraInWeb: [] },
  );
});
