import { readFileSync } from 'node:fs'
import { type Card, cardKey, handScore, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { FLOP_DATA_TURN } from './bot-flop-end-data.js'
import { type RangeCombo, type RiverSpot, riverValues, solveRiver } from './bot-river-solver.js'
import { comboIndex52, encodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import { perRiverShowdown } from './bot-turn-river-leaves.js'
import { solveTurn } from './bot-turn-solver.js'
import {
  decodeTurnStartRecord,
  encodeTurnStartRecord,
  type TurnStartLeaves,
  turnStartRecord,
} from './bot-turn-start-data.js'
import {
  type RiverValueNetwork,
  type ValueNetworkDescription,
  valueNetworkFrom,
} from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
const neutral: RiverValueNetwork = {
  ...network,
  checked: { inputs: false },
  layers: network.layers.map((layer) => ({
    ...layer,
    weight: new Float32Array(layer.weight.length),
    bias: new Float32Array(layer.bias.length),
  })),
}
const spot: RiverSpot = {
  board: cards('Ah Kd 7s 4c'),
  pot: 137,
  stack: 523,
  // Deliberately unsorted, weighted, overlapping ranges expose ordering and blockers.
  ranges: [
    [combo('Qc Jc', 2), combo('8s 8h'), combo('5d 6d', 3), combo('As 2s')],
    [combo('Kc Qh', 3), combo('Qc 9c', 2), combo('7c 7d'), combo('8c 9c')],
  ],
  ...FLOP_DATA_TURN,
}
const meta = { spot: 17, worker: 123 }
const checks = { betSizes: [], maxRaises: 0, allIn: false }
const indexOf = (held: RangeCombo) => comboIndex52(cardKey(held.hole[0]), cardKey(held.hole[1]))

describe('turn-start teacher records', () => {
  it('matches an independent count of every river and compatible opponent holding', () => {
    // Mutation: omit the checked-down addition (or use 48 rather than 44 rivers per pair).
    const record = turnStartRecord(spot, { kind: 'turn-end', network: neutral }, meta, checks)
    for (const player of [0, 1] as const) {
      for (const held of spot.ranges[player]) {
        let won = 0
        let mass = 0
        for (const opponent of spot.ranges[player === 0 ? 1 : 0]) {
          const keys = [...spot.board, ...held.hole, ...opponent.hole].map(cardKey)
          if (new Set(keys).size !== keys.length) continue
          for (const river of makeDeck()) {
            if (keys.includes(cardKey(river))) continue
            const board = [...spot.board, river]
            const mine = handScore([...held.hole, ...board])
            const theirs = handScore([...opponent.hole, ...board])
            won += opponent.weight * (mine > theirs ? 1 : mine === theirs ? 0.5 : 0)
            mass += opponent.weight
          }
        }
        expect(record.values[player][indexOf(held)]).toBeCloseTo(won / mass, 6)
      }
    }
  })

  for (const kind of ['turn-end', 'per-river'] as const) {
    it(`stores both ${kind} root rows in pots by comboIndex52`, () => {
      // Mutations: write values[h], swap players, or remove / turn.pot.
      const leaves: TurnStartLeaves =
        kind === 'turn-end' ? { kind, network } : { kind, riverNetwork: network }
      // The sampler's river tree must be replaced by the live turn tree.
      const record = turnStartRecord({ ...spot, betSizes: [0.2, 1], maxRaises: 2 }, leaves, meta)
      const solution =
        kind === 'turn-end'
          ? solveTurn(spot, FLOP_DATA_TURN.iterations, network)
          : solveRiver(spot, FLOP_DATA_TURN.iterations, undefined, perRiverShowdown(spot, network))
      const root = riverValues(solution)
      for (const player of [0, 1] as const) {
        const held = root.hands[player]
        const present = new Set<number>()
        for (let h = 0; h < held.combos.length; h += 1) {
          const index = indexOf(held.combos[h] as RangeCombo)
          present.add(index)
          expect(record.values[player][index]).toBeCloseTo(
            (root.values[player][h] as number) / spot.pot,
            6,
          )
        }
        record.values[player].forEach((value, index) => {
          if (!present.has(index)) expect(value).toBe(0)
        })
        expect(record.ranges[player].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6)
      }
      expect(record.board).toEqual([...spot.board.map(cardKey), 255])
      expect(record.iterations).toBe(FLOP_DATA_TURN.iterations)
    }, 60_000)
  }

  it('uses per-river leaves and preserves distinct teacher tags in the binary header', () => {
    // Mutation: select turnShowdown for per-river, or encode both targets with the same byte.
    const direct = turnStartRecord(spot, { kind: 'turn-end', network }, meta, checks)
    const perRiver = turnStartRecord(
      spot,
      { kind: 'per-river', riverNetwork: network },
      meta,
      checks,
    )
    expect(direct.target).toBe('turn-start/turn-end-v1')
    expect(perRiver.target).toBe('turn-start/per-river-v1')
    let difference = 0
    for (const player of [0, 1] as const) {
      for (const held of spot.ranges[player]) {
        const index = indexOf(held)
        difference += Math.abs(
          (direct.values[player][index] as number) - (perRiver.values[player][index] as number),
        )
      }
    }
    expect(difference).toBeGreaterThan(0.001)
    for (const [record, code] of [
      [direct, 1],
      [perRiver, 2],
    ] as const) {
      const bytes = encodeTurnStartRecord(record)
      expect(bytes.length).toBe(RIVER_RECORD_BYTES)
      expect(bytes[5]).toBe(code)
      const restored = decodeTurnStartRecord(bytes)
      expect(restored.target).toBe(record.target)
      expect(restored.values).toEqual(record.values)
      expect(restored.ranges).toEqual(record.ranges)
      expect(restored.strengthRank).toEqual(record.strengthRank)
    }
    expect(() => decodeTurnStartRecord(encodeRiverRecord(direct))).toThrow(/tagged/)
    expect(() =>
      turnStartRecord(
        { ...spot, board: spot.board.slice(0, 3) },
        { kind: 'turn-end', network },
        meta,
      ),
    ).toThrow(/four board/)
  })
})
