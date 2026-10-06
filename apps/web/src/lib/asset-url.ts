/**
 * Cache-busting for assets the art pipeline republishes in place.
 *
 * `rooftop_assets.glb` and `lighting.json` are rewritten at the same URLs many times an
 * hour while a character is being worked on. drei's loader cache and the browser's HTTP
 * cache both key on the URL, so reloading a review kept showing a character several builds
 * old. A review that quietly shows the wrong build is worse than no review, because the
 * work looks like it did not land.
 *
 * The token is fixed for the life of the module, so every consumer in a single page load
 * requests the same URL and each asset is still fetched exactly once. A full reload
 * re-evaluates the module and picks up whatever the pipeline has published since.
 * Production keeps the bare path, because there an asset only changes when the build does.
 *
 * This lives in its own module rather than in `venue.ts` deliberately. `lighting.ts`
 * already refers back to `venue.ts` for types only, and `cameraPlacement` carries a
 * written-out copy of `blenderToThree` specifically to avoid importing across that
 * boundary - the scene loads through a dynamic chunk that will not tolerate the cycle. A
 * type-only import erases and is safe; a value import would not have been.
 */
const ASSET_TOKEN: string | null = process.env.NODE_ENV === 'production' ? null : `${Date.now()}`

export function freshAsset(path: string): string {
  if (ASSET_TOKEN === null) return path
  return `${path}${path.includes('?') ? '&' : '?'}dev=${ASSET_TOKEN}`
}
