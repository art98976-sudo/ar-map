import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3005);

/**
 * End-to-end tests run on a phone-sized screen against a production build.
 * `npm run test:e2e` builds and starts the app automatically.
 */
export default defineConfig({
  testDir: './e2e',
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
        url: `http://localhost:${PORT}`,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      },
});
