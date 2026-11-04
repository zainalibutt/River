import { describe, expect, it } from 'vitest'
import { HOLDING_CARDS } from './bot-turn-end-data.js'
import { turnCardFeatures, turnResidualInputs, turnResidualPools } from './bot-turn-residual.js'
import { packDistillationFeatures } from './bot-turn-residual-distill.js'

describe('all-holding distillation packing', () => {
  it('preserves all legal features, targets and normalised weights through the stride permutation', () => {
    const board = [0, 15, 30, 45]
    const ranks = Uint16Array.from(HOLDING_CARDS, ([a, b], h) =>
      board.includes(a) || board.includes(b) ? 0 : 1 + (h % 1000),
    )
    const cards = turnCardFeatures(board, ranks)
    const ranges = [
      Float32Array.from(ranks, (r, h) => (r ? h % 7 : 100)),
      Float32Array.from(ranks, (r, h) => (r ? h % 13 : 100)),
    ] as const
    const pools = turnResidualPools(cards, ranges)
    const base = Float32Array.from({ length: 256 }, (_, i) => i / 256)
    const full = turnResidualInputs(cards, ranges, base, 20, 3)
    const compact = turnResidualInputs(cards, ranges, base, 20, 3, undefined, pools, true)
    const values = [
      Float32Array.from(ranks, (_, h) => h / 1326),
      Float32Array.from(ranks, (_, h) => -h / 1326),
    ] as const
    const { local, shared } = packDistillationFeatures(cards, pools, base, compact, values)
    const seen = new Set<number>()
    let row = 0
    for (let h = 0; h < 1326; h++) {
      if (!ranks[h]) continue
      const packed = (row++ * 37) % 1128
      seen.add(packed)
      const at = packed * 34
      for (const p of [0, 1] as const) {
        const actual = [
          shared[39 + p * 128 + (local[at + 33] as number)],
          p,
          shared[0],
          ...local.slice(at, at + 19),
          ...local.slice(at + 19 + p * 5, at + 24 + p * 5),
          ...shared.slice(1 + p * 19, 20 + p * 19),
          ...shared.slice(1 + (1 - p) * 19, 20 + (1 - p) * 19),
        ]
        const start = (p * 1326 + h) * 65
        expect(actual).toEqual(Array.from(full.slice(start, start + 65)))
        expect(local[at + 29 + p]).toBe(values[p][h])
        expect(local[at + 31 + p]).toBe(Math.fround(pools.weights[p][h] as number))
      }
    }
    expect(seen.size).toBe(1128)
    expect(local.length).toBe(1128 * 34)
    expect(shared.length).toBe(295)
  })
})
