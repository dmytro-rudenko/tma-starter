import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@pctea/tma-web/react', replacement: here('./src/react/index.ts') },
      { find: '@pctea/tma-web', replacement: here('./src/index.ts') },
      {
        find: '@pctea/tma-testing/dom',
        replacement: here('../testing/src/dom/index.ts'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
});
