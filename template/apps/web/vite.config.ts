import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = 'http://127.0.0.1:3100';
const fakeBot = 'http://127.0.0.1:3199';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/socket.io': { target: api, changeOrigin: false, ws: true },
      '/api': { target: api, changeOrigin: false },
      '/bot': { target: fakeBot, changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    // Node's built-in localStorage shadows jsdom's, so tests would see it undefined.
    poolOptions: {
      forks: { maxForks: 4, minForks: 1, execArgv: ['--no-experimental-webstorage'] },
    },
  },
});
