import {defineConfig, devices} from '@playwright/test'

// E2E tests run against the production build (vite preview), like Vercel serves it.
// Port 4310 avoids clashes with other local dev servers on the default 4173.
const fakeCamera = {args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']}
const sensors = ['camera', 'accelerometer', 'gyroscope', 'magnetometer']

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4310',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {...devices['Desktop Chrome'], permissions: sensors, launchOptions: fakeCamera},
    },
    {
      // Android phone with a fake camera: runs the real 8th Wall engine end to end.
      name: 'android-chrome',
      use: {...devices['Pixel 7'], permissions: sensors, launchOptions: fakeCamera},
    },
    {
      // Safari engine on an iPhone 15 Pro screen. Desktop WebKit has no camera,
      // so tests stub the camera and motion APIs where needed.
      name: 'iphone-safari',
      use: {...devices['iPhone 15 Pro']},
    },
  ],
})
