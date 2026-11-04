import { describe, expect, it } from 'vitest'
import { flopBucketIds, flopLayout } from './bot-flop-buckets.js'
import { COMBOS } from './bot-river-value-data.js'
import {
  bucketInputs,
  bucketsFromIds,
  type RiverValueNetwork,
  valueNetworkFrom,
} from './bot-value-network.js'

const row = (values: number[]) => {
  const ranks = new Uint16Array(COMBOS)
  ranks.set(values)
  return ranks
}
const ranks = row([1, 1, 1, 1, 1, 1, 1, 1])
const next = [row([1, 2, 3, 4, 5, 6, 7, 8]), row([8, 7, 6, 5, 4, 3, 2, 1])]

describe('D3 next-card spread buckets', () => {
  it('separates equal-mean hands by variance, preserving ties and blocked holdings', () => {
    // Independent oracle: means are all 1/2. Deviations are +/-7,5,3,1 /16.
    // Two holdings per variance, with midpoint percentiles 1,3,5,7 /8.
    // Mutation killed: accumulate p rather than p*p in square[h].
    const ids = flopBucketIds(ranks, next, 1, 4)
    expect([...ids.slice(0, 8)]).toEqual([3, 2, 1, 0, 0, 1, 2, 3])
    expect([...ids.slice(8)].every((id) => id === 255)).toBe(true)
    expect([...flopBucketIds(ranks, [...next].reverse(), 1, 4)]).toEqual([...ids])
  })

  it('keeps both axes tied rather than depending on holding index', () => {
    // Mutation killed: use member index rather than tie midpoint for potential.
    const ids = flopBucketIds(row([1, 1, 2, 2]), [row([1, 1, 2, 2])], 2, 4)
    expect([...ids.slice(0, 4)]).toEqual([2, 2, 6, 6])
  })

  it('rejects missing futures and dimensions that collide with the blocked sentinel', () => {
    // Mutations killed: remove count===0 guard; change product bound to 256.
    expect(() => flopBucketIds(ranks, [], 1, 4)).toThrow('no next cards')
    expect(() => flopBucketIds(ranks, next, 64, 4)).toThrow('dimensions')
    expect(() => flopBucketIds(ranks, next, 0, 4)).toThrow('dimensions')
  })

  it('aggregates different draw ranges into distinct inputs and respects player order', () => {
    // Mutation killed: use strength-only ids, or swap player range offsets.
    const layout = bucketsFromIds(flopBucketIds(ranks, next, 1, 4), 4)
    const a = new Float32Array(COMBOS)
    const b = new Float32Array(COMBOS)
    a[0] = 1
    b[3] = 1
    expect([...bucketInputs(layout, [a, b], 100, 100)]).toEqual([
      0, 0, 0, 0, 4, 4, 0, 0, 0, 1, 1, 1, 1,
    ])
  })

  it('loads versioned flop metadata and rejects obsolete turn layouts at flop inference', () => {
    // Mutation killed: omit flopBuckets when loading the export; omit turn guard.
    const description = {
      buckets: 128,
      flopBuckets: { version: 1 as const, strength: 32, potential: 4 },
      tensors: [
        { name: '0.weight', shape: [256, 385], offset: 0 },
        { name: '0.bias', shape: [256], offset: 256 * 385 * 4 },
      ],
    }
    const network = valueNetworkFrom(description, new Float32Array(256 * 386))
    expect(network.flopBuckets).toEqual(description.flopBuckets)
    expect(() =>
      valueNetworkFrom(
        { ...description, flopBuckets: { version: 1, strength: 31, potential: 4 } },
        new Float32Array(),
      ),
    ).toThrow('metadata')
    const turn: RiverValueNetwork = {
      buckets: 128,
      layers: [],
      turnBuckets: { strength: 32, potential: 4 },
    }
    expect(() => flopLayout([{} as never, {} as never, {} as never], ranks, turn)).toThrow(
      'turn bucket',
    )
  })
})
