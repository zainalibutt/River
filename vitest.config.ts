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
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
})
