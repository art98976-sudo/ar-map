import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3005);
/** Which data the local test build uses: sample data by default, or MazeMap (campus 2058). */
const PROVIDER = process.env.E2E_PROVIDER === 'mazemap' ? 'mazemap' : 'local';

/**
 * End-to-end tests run on a phone-sized screen against a production build.
 * `npm run test:e2e` builds and starts the app automatically.
 */
export default defineConfig({
  testDir: './e2e',
  // Sample-data specs and the MazeMap spec need different builds.
  testMatch: PROVIDER === 'mazemap' ? /mazemap\.spec\.ts$/ : /^(?!.*mazemap).*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 740 },
        // A position on campus, so "My location" works without a real GPS.
        geolocation: { latitude: 56.1456, longitude: -3.9215 },
        permissions: ['geolocation'],
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        // Set explicitly so a local .env.local cannot change which data the tests see.
        env: PROVIDER === 'mazemap'
          ? { MAP_PROVIDER: 'mazemap', MAZEMAP_CAMPUS_ID: process.env.MAZEMAP_CAMPUS_ID ?? '2058' }
          : { MAP_PROVIDER: 'local' },
        url: `http://localhost:${PORT}`,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      },
});
