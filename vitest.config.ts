import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // apps/web resolves this through tsconfig paths. Vitest needs telling
      // separately, and a web module that imports a sibling any other way
      // fails in Turbopack while passing both typecheck and the suite.
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'hygiene.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // The suite runs 2,300 tests across every core, solver work among them. At
    // the default five seconds, whichever few were slowest on a busy machine
    // timed out, a different few each run, and a red suite said nothing.
    testTimeout: 30_000,
    globalSetup: ['./vitest.database-guard.ts'],
  },
})
