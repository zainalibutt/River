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
    // Held, not abandoned. venue-art judges the palette of the venue files the
    // application serves, and those files are a build behind: every surface
    // still carries a white base colour because the 5W occlusion fix has not
    // been published yet. The gate is correct and currently red for that
    // reason alone - it passes on the pipeline build, which is how it was
    // proven to both fire and pass:
    //
    //   RIVER_ASSET_DIR=art/out npx vitest run apps/web/src/lib/venue-art.test.ts
    //
    // Delete this exclude the moment publish_assets.py has run. Leaving it in
    // turns a working gate into decoration, which this project already has
    // enough of.
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
})
