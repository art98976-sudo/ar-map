import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Opt-in checks against live services (MazeMap). Run with `npm run test:live`. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
