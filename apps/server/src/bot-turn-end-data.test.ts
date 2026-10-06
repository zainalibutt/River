import { type Card, cardKey, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type RangeCombo, type RiverSpot, riverValues, solveRiver } from './bot-river-solver.js'
import {
  COMBOS,
  comboIndex52,
  RIVER_DATA_SETTINGS,
  solveTurnTruthRecord,
} from './bot-river-value-data.js'
import {
  expectedStrengthRanks,
  turnBucketIds,
  turnEndValues,
  turnRivers,
} from './bot-turn-end-data.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const index = (text: string) => {
  const [a, b] = cards(text) as [Card, Card]
  return comboIndex52(cardKey(a), cardKey(b))
}

describe('expected strength on the turn', () => {
  it('ranks every live holding: a set above a small pair, and a small pair above a gutshot', () => {
    const ranks = expectedStrengthRanks(turnRivers(cards('Ah Kd 7s 4c')))
    expect([...ranks].filter((rank) => rank > 0)).toHaveLength(1128)
    expect(ranks[index('7c 7d')]).toBeGreaterThan(ranks[index('2c 2d')] as number)
    expect(ranks[index('2c 2d')]).toBeGreaterThan(ranks[index('3d 5h')] as number)
  })
})

describe('values where the turn ends', () => {
  it('weigh each river as the deal falls, matching the exact truth with the solver plugged in', () => {
    // Small ranges that share cards, so card removal matters on every river.
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
      pot: 100,
      stack: 300,
      ranges: [
        [combo('Ac Qc', 1), combo('7c 7d', 2), combo('Qs Js', 1), combo('5c 6c', 3)],
        [combo('As Qd', 2), combo('Kc Qc', 1), combo('8h 8d', 1), combo('6h 5h', 2)],
      ],
      betSizes: [1],
      allIn: true,
      maxRaises: 1,
    }
    const settings = { ...RIVER_DATA_SETTINGS, iterations: 60, deepIterations: 60 }
    const truth = solveTurnTruthRecord(spot, settings, { spot: 0, worker: 0 })
    const values = turnEndValues(spot, turnRivers(spot.board), (river) => {
      const { hands, values: solved } = riverValues(solveRiver(river, 60))
      const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
      for (const player of [0, 1] as const) {
        hands[player].combos.forEach((held, h) => {
          out[player][comboIndex52(cardKey(held.hole[0]), cardKey(held.hole[1]))] =
            (solved[player][h] as number) / river.pot
        })
      }
      return out
    })
    for (const player of [0, 1] as const) {
      for (const held of spot.ranges[player]) {
        const at = comboIndex52(cardKey(held.hole[0]), cardKey(held.hole[1]))
        expect(values[player][at]).toBeCloseTo(truth.values[player][at] as number, 5)
      }
    }
  })
})

describe('two-dimensional turn buckets', () => {
  it('fill all 128, put a stronger holding in a stronger slice, and split every slice four ways', () => {
    const ids = turnBucketIds(turnRivers(cards('Ah Kd 7s 4c')), 32, 4)
    const live = [...ids].filter((id) => id !== 255)
    expect(live).toHaveLength(1128)
    expect(new Set(live).size).toBe(128)
    const slice = (text: string) => Math.floor((ids[index(text)] as number) / 4)
    expect(slice('7c 7d')).toBeGreaterThan(slice('2c 2d'))
    // Within a slice of expected strength, potential splits the holdings evenly.
    for (let strength = 0; strength < 32; strength += 1) {
      const counts = [0, 0, 0, 0]
      for (const id of live) {
        if (Math.floor(id / 4) === strength) counts[id % 4] = (counts[id % 4] as number) + 1
      }
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
    }
  })
})
