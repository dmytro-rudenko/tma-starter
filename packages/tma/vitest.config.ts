import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      { find: 'tma-starter/web/react', replacement: here('./src/web/react/index.ts') },
      { find: 'tma-starter/web', replacement: here('./src/web/index.ts') },
      { find: 'tma-starter/testing/dom', replacement: here('./src/testing/dom/index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/web/**/*.test.{ts,tsx}', 'test/web/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
