import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3005);
/** Which data the local test build uses: sample data by default, or MazeMap (campus 2058). */
const PROVIDER = process.env.E2E_PROVIDER === 'mazemap' ? 'mazemap' : 'local';
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

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
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // The first-run tutorial counts as seen, so it does not cover the screens under test
    // (e2e/onboarding.spec.ts starts without it).
    storageState: { cookies: [], origins: [{ origin: BASE_URL, localStorage: [{ name: 'stirling-campus-map:onboarding-seen', value: '1' }] }] },
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 360, height: 740 },
        // A position on campus, so "My location" works without a real GPS.
        geolocation: { latitude: 56.1456, longitude: -3.9215 },
        permissions: ['geolocation', 'camera'],
        // A fake camera, so AR can be tested without a device.
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
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
        url: BASE_URL,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      },
});
