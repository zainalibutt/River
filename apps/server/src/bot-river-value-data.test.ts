import { type Card, cardKey, handScore, makeDeck, mulberry32, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { RangeCombo, RiverSpot } from './bot-river-solver.js'
import {
  COMBOS,
  comboIndex52,
  decodeRiverRecord,
  encodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  RIVER_RECORD_LAYOUT,
  randomRangeWeights,
  roundsFor,
  sampleRiverSpot,
  sampleTurnEndSpot,
  solveRiverRecord,
  solveTurnTruthRecord,
  strengthRanks,
} from './bot-river-value-data.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})

describe('holding numbers', () => {
  it('follow the deck, so a card key is its place in makeDeck()', () => {
    makeDeck().forEach((card, index) => {
      expect(cardKey(card)).toBe(index)
    })
  })

  it('number every holding once, in the order the Python reader uses', () => {
    let expected = 0
    for (let a = 0; a < 52; a += 1) {
      for (let b = a + 1; b < 52; b += 1) {
        expect(comboIndex52(a, b)).toBe(expected)
        expect(comboIndex52(b, a)).toBe(expected)
        expected += 1
      }
    }
    expect(expected).toBe(COMBOS)
  })
})

describe('random ranges', () => {
  it('give every holding some weight, and sum to one', () => {
    const weights = randomRangeWeights(1081, mulberry32(1))
    expect(Math.min(...weights)).toBeGreaterThan(0)
    expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 9)
  })

  it('lean towards strong hands in some spots and weak hands in others', () => {
    const rng = mulberry32(2)
    const strongShares = Array.from({ length: 50 }, () => {
      const weights = randomRangeWeights(1081, rng)
      return weights.subarray(540).reduce((sum, weight) => sum + weight, 0)
    })
    expect(Math.min(...strongShares)).toBeLessThan(0.2)
    expect(Math.max(...strongShares)).toBeGreaterThan(0.8)
  })
})

describe('sampled spots', () => {
  it('come out the same from the same seed, with both ranges over every live holding', () => {
    const first = sampleRiverSpot('test:0:7', RIVER_DATA_SETTINGS)
    const again = sampleRiverSpot('test:0:7', RIVER_DATA_SETTINGS)
    expect(again).toEqual(first)
    expect(new Set(first.board.map(cardKey)).size).toBe(5)
    const blocked = new Set(first.board.map(cardKey))
    for (const range of first.ranges) {
      expect(range).toHaveLength(1081)
      for (const combo of range) {
        expect(blocked.has(cardKey(combo.hole[0]))).toBe(false)
        expect(blocked.has(cardKey(combo.hole[1]))).toBe(false)
        expect(combo.weight).toBeGreaterThan(0)
      }
    }
    const ratio = first.stack / first.pot
    expect(ratio).toBeGreaterThanOrEqual(RIVER_DATA_SETTINGS.minStackToPot - 1e-4)
    expect(ratio).toBeLessThanOrEqual(RIVER_DATA_SETTINGS.maxStackToPot + 1e-4)
  })
})

describe('solver rounds', () => {
  it('double for deep spots, where errors in pots grow with the stack', () => {
    const spot = sampleRiverSpot('test:0:7', RIVER_DATA_SETTINGS)
    const shallow = { ...spot, stack: spot.pot * 2 }
    const deep = { ...spot, stack: spot.pot * 20 }
    expect(roundsFor(shallow, RIVER_DATA_SETTINGS)).toBe(200)
    expect(roundsFor(deep, RIVER_DATA_SETTINGS)).toBe(400)
  })
})

describe('strength ranks', () => {
  it('tie every holding when the board is the best hand', () => {
    const ranks = strengthRanks(cards('As Ks Qs Js Ts'))
    const live = [...ranks].filter((rank) => rank > 0)
    expect(live).toHaveLength(1081)
    expect(new Set(live)).toEqual(new Set([1]))
  })

  it('put the wheel straight on top of an ace-high board', () => {
    const ranks = strengthRanks(cards('Ah Kd 7s 4c 2h'))
    const top = Math.max(...ranks)
    const deck = makeDeck()
    const best: string[] = []
    for (let a = 0; a < 52; a += 1) {
      for (let b = a + 1; b < 52; b += 1) {
        if (ranks[comboIndex52(a, b)] === top) {
          const pair = [deck[a] as Card, deck[b] as Card].map((card) => card.rank).sort()
          best.push(pair.join(''))
        }
      }
    }
    expect(best).toHaveLength(16)
    expect(new Set(best)).toEqual(new Set(['35']))
  })
})

describe('river records', () => {
  it('describe their layout to the byte', () => {
    const last = RIVER_RECORD_LAYOUT[RIVER_RECORD_LAYOUT.length - 1]
    expect(last?.offset).toBe(RIVER_RECORD_BYTES - 2 * COMBOS)
    expect(RIVER_RECORD_BYTES).toBe(23_900)
  })

  it('hold a solved spot, and read back exactly', () => {
    const spot = sampleRiverSpot('test:0:3', RIVER_DATA_SETTINGS)
    const record = solveRiverRecord(spot, 5, { spot: 3, worker: 0, measure: true })
    expect(record.board).toEqual(spot.board.map(cardKey))
    expect(Number.isFinite(record.exploitability)).toBe(true)
    for (const player of [0, 1] as const) {
      expect(record.ranges[player].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
      record.strengthRank.forEach((rank, index) => {
        if (rank === 0) {
          expect(record.ranges[player][index]).toBe(0)
          expect(record.values[player][index]).toBe(0)
        } else {
          expect(record.ranges[player][index]).toBeGreaterThan(0)
        }
      })
    }
    const bytes = encodeRiverRecord(record)
    expect(bytes).toHaveLength(RIVER_RECORD_BYTES)
    const twice = new Uint8Array(2 * RIVER_RECORD_BYTES)
    twice.set(bytes, RIVER_RECORD_BYTES)
    const back = decodeRiverRecord(twice, RIVER_RECORD_BYTES)
    expect(back.board).toEqual(record.board)
    expect(back.pot).toBe(record.pot)
    expect(back.stack).toBe(record.stack)
    expect(back.spot).toBe(3)
    expect(back.iterations).toBe(5)
    expect(back.exploitability).toBeCloseTo(record.exploitability, 6)
    expect(back.ranges).toEqual(record.ranges)
    expect(back.values).toEqual(record.values)
    expect(back.strengthRank).toEqual(record.strengthRank)
  }, 60_000)
})

describe('the turn truth set', () => {
  it('samples turns with ranges over every holding the turn leaves possible', () => {
    const turn = sampleTurnEndSpot('test:0:5', RIVER_DATA_SETTINGS)
    expect(sampleTurnEndSpot('test:0:5', RIVER_DATA_SETTINGS)).toEqual(turn)
    expect(turn.board).toHaveLength(4)
    for (const range of turn.ranges) expect(range).toHaveLength(1128)
    const ranks = strengthRanks(turn.board)
    expect([...ranks].filter((rank) => rank > 0)).toHaveLength(1128)
  })

  it('averages each holding over every river that can come, as the deal falls', () => {
    const board = cards('Ah Kd 7s 4c')
    const theirs = [
      { text: '7c 7d', weight: 1 },
      { text: 'Qc Jc', weight: 2 },
    ]
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 1_000,
      ranges: [[combo('8s 8h')], theirs.map(({ text, weight }) => combo(text, weight))],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const record = solveTurnTruthRecord(spot, RIVER_DATA_SETTINGS, { spot: 0, worker: 0 })
    // Every river card and every opposing holding that clashes with neither hand.
    const ours = cards('8s 8h')
    let won = 0
    let total = 0
    for (const river of makeDeck()) {
      if ([...board, ...ours].some((card) => cardKey(card) === cardKey(river))) continue
      for (const { text, weight } of theirs) {
        const other = cards(text)
        if (other.some((card) => cardKey(card) === cardKey(river))) continue
        const mine = handScore([...ours, ...board, river])
        const them = handScore([...other, ...board, river])
        won += weight * (mine > them ? 1 : mine === them ? 0.5 : 0)
        total += weight
      }
    }
    const index = comboIndex52(cardKey(ours[0] as Card), cardKey(ours[1] as Card))
    expect(record.values[0][index]).toBeCloseTo(won / total, 5)
    expect(record.board[4]).toBe(255)
    expect(record.ranges[1].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
  })
})
