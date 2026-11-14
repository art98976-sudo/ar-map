import {defineConfig, devices} from '@playwright/test'

// E2E tests run against the production build (vite preview), like Vercel serves it.
// Port 4311 is for tests only (4310 is for manual previews; 4173 is taken by another app here).
const fakeCamera = {args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']}
const sensors = ['camera', 'accelerometer', 'gyroscope', 'magnetometer', 'geolocation']
// A good GPS fix on the walkway between the Cottrell Building and the Atrium.
const onCampus = {latitude: 56.14525, longitude: -3.9201, accuracy: 6}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4311',
    trace: 'retain-on-failure',
    // The service worker (8.1) would answer requests the tests intercept: keep it out of the way.
    serviceWorkers: 'block',
  },
  webServer: {
    // Always build fresh and use a test-only port, so a forgotten preview server is never reused.
    // A test build: the production build plus the developer tools (?simulate=1, ?debug=...,
    // ?fieldtest=1) the tests drive. tests/unit/dev-tools.test.js checks production has none of them.
    command: 'npm run build:test && npm run preview -- --host 127.0.0.1 --port 4311',
    url: 'http://127.0.0.1:4311',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {...devices['Desktop Chrome'], permissions: sensors, geolocation: onCampus, launchOptions: fakeCamera},
    },
    {
      // Android phone with a fake camera: runs the real 8th Wall engine end to end.
      name: 'android-chrome',
      use: {...devices['Pixel 7'], permissions: sensors, geolocation: onCampus, launchOptions: fakeCamera},
    },
    {
      // Safari engine on an iPhone 15 Pro screen. Desktop WebKit has no camera,
      // so tests stub the camera and motion APIs where needed.
      name: 'iphone-safari',
      use: {...devices['iPhone 15 Pro'], permissions: ['geolocation'], geolocation: onCampus},
    },
  ],
})
