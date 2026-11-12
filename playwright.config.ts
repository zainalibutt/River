import { defineConfig } from '@playwright/test'

/**
 * 1920x1080 is River's base canvas. The table stage scales itself by
 * `min(innerWidth / 1920, innerHeight / 1080)`, so at exactly this viewport the
 * scale is 1 and a CSS pixel is a base-canvas pixel. Every dimension in
 * the table layout and interaction designs is quoted in those units,
 * so measuring at any other viewport silently compares against the wrong
 * numbers. `assertBaseCanvas` in the spec fails loudly if the scale drifts.
 */
const baseURL = process.env.RIVER_E2E_URL ?? 'http://localhost:3100'

export default defineConfig({
  // The tests expect an app that is already running. Where nothing is, as in
  // CI, RIVER_E2E_SERVER=1 starts the built one on the base URL's port, with
  // whatever database this process was handed.
  ...(process.env.RIVER_E2E_SERVER === '1'
    ? {
        webServer: {
          command: 'npm start',
          url: new URL('/api/config', baseURL).toString(),
          env: { NODE_ENV: 'production', PORT: new URL(baseURL).port },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      }
    : {}),
  testDir: './apps/web/e2e',
  globalSetup: './apps/web/e2e/database-guard.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
})
