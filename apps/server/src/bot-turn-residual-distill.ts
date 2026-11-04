import type { TurnCardFeatures, turnResidualPools } from './bot-turn-residual.js'

/** Spread holding order across contiguous training stripes without random disk reads. */
export function packDistillationFeatures(
  cards: TurnCardFeatures,
  pools: ReturnType<typeof turnResidualPools>,
  base: Float32Array,
  features: Float32Array,
  values: readonly [ArrayLike<number>, ArrayLike<number>],
) {
  if (cards.layout.live !== 1128 || features.length !== 2 * 1128 * 65)
    throw new Error('invalid all-holding features')
  const local = new Float32Array(1128 * 34),
    shared = new Float32Array(295)
  shared[0] = features[2] as number
  shared.set(pools.pool[0], 1)
  shared.set(pools.pool[1], 20)
  shared.set(base, 39)
  let row = 0
  for (let h = 0; h < 1326; h++) {
    const b = cards.layout.bucketOf[h] as number
    if (b < 0) continue
    // gcd(37,1128)=1: a bijection; a contiguous stripe spans the original order.
    const at = ((row * 37) % 1128) * 34
    local.set(cards.holding.subarray(h * 19, (h + 1) * 19), at)
    for (const p of [0, 1] as const) {
      const f = (p * 1128 + row) * 65 + 22
      local.set(features.subarray(f, f + 5), at + 19 + p * 5)
      local[at + 29 + p] = values[p][h] as number
      local[at + 31 + p] = pools.weights[p][h] as number
    }
    local[at + 33] = b
    row++
  }
  return { local, shared }
}
