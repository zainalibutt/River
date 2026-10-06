import { type Card, cardKey, mulberry32, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type RangeCombo, type RiverSpot, riverValues, solveRiver } from './bot-river-solver.js'
import {
  COMBOS,
  comboIndex52,
  RIVER_DATA_SETTINGS,
  solveTurnTruthRecord,
  strengthRanks,
} from './bot-river-value-data.js'
import {
  checkedDownValues,
  expectedStrengthRanks,
  showdownShares,
  turnBucketIds,
  turnEndValues,
  turnRivers,
} from './bot-turn-end-data.js'
import { rangeWeights } from './bot-value-network.js'

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

describe('values if the hand is checked down', () => {
  /** The two card keys of a holding, by `comboIndex52`. */
  const holdingCards = (() => {
    const out: [number, number][] = []
    for (let a = 0; a < 52; a += 1) for (let b = a + 1; b < 52; b += 1) out.push([a, b])
    return out
  })()
  const clash = (x: number, y: number) => {
    const [a, b] = holdingCards[x] as [number, number]
    const [c, d] = holdingCards[y] as [number, number]
    return a === c || a === d || b === c || b === d
  }

  it('share the pot card by card on a river, as a brute force does', () => {
    const ranks = strengthRanks(cards('Ah Kd 7s 4c 7h'))
    const random = mulberry32(7)
    const opponent = new Float64Array(COMBOS)
    for (let i = 0; i < COMBOS; i += 1) {
      if ((ranks[i] as number) > 0 && random() < 0.6) opponent[i] = random()
    }
    const shares = showdownShares(ranks, opponent)
    for (let h = 0; h < COMBOS; h += 1) {
      if ((ranks[h] as number) === 0) continue
      let won = 0
      let met = 0
      for (let o = 0; o < COMBOS; o += 1) {
        const weight = opponent[o] as number
        if (weight === 0 || (ranks[o] as number) === 0 || clash(h, o)) continue
        met += weight
        const mine = ranks[h] as number
        const theirs = ranks[o] as number
        won += mine > theirs ? weight : mine === theirs ? weight / 2 : 0
      }
      expect(shares[h]).toBeCloseTo(met > 0 ? won / met : 0, 12)
    }
  })

  it('average those shares over every river as the deal falls', () => {
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
    const rivers = turnRivers(spot.board)
    const values = checkedDownValues(spot, rivers)
    const weights = rangeWeights(spot)
    for (const player of [0, 1] as const) {
      const mine = weights[player]
      const theirs = weights[player === 0 ? 1 : 0]
      for (let h = 0; h < COMBOS; h += 1) {
        if ((mine[h] as number) === 0) continue
        let won = 0
        let met = 0
        for (const river of rivers.rivers) {
          if ((river.ranks[h] as number) === 0) continue
          for (let o = 0; o < COMBOS; o += 1) {
            const weight = theirs[o] as number
            if (weight === 0 || (river.ranks[o] as number) === 0 || clash(h, o)) continue
            met += weight
            const a = river.ranks[h] as number
            const b = river.ranks[o] as number
            won += a > b ? weight : a === b ? weight / 2 : 0
          }
        }
        expect(values[player][h]).toBeCloseTo(won / met, 12)
      }
    }
  })
})
