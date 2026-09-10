import { defineConfig } from '@playwright/test'

/**
 * 1920x1080 is River's base canvas. The table stage scales itself by
 * `min(innerWidth / 1920, innerHeight / 1080)`, so at exactly this viewport the
 * scale is 1 and a CSS pixel is a base-canvas pixel. Every dimension in
 * `docs/design/04-anatomy.md` and `06-interaction.md` is quoted in those units,
 * so measuring at any other viewport silently compares against the wrong
 * numbers. `assertBaseCanvas` in the spec fails loudly if the scale drifts.
 */
export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.RIVER_E2E_URL ?? 'http://localhost:3100',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
  },
})
