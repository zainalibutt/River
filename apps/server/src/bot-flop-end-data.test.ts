import { readFileSync } from 'node:fs'
import { type Card, cardKey, handScore, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { flopEndRecord } from './bot-flop-end-data.js'
import type { RangeCombo, RiverSpot } from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
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
const index = (text: string) => {
  const [a, b] = cards(text) as [Card, Card]
  return comboIndex52(cardKey(a), cardKey(b))
}
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
const flop: RiverSpot = {
  board: cards('Ah Kd 7s'),
  pot: 100,
  stack: 400,
  ranges: [
    [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d'), combo('As 2s')],
    [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c'), combo('Th Jh')],
  ],
  betSizes: [0.5, 1],
  allIn: true,
  maxRaises: 2,
}
const meta = { seed: 'flop-test:0:0', spot: 0, worker: 0 }

describe('records where the flop ends', () => {
  it('give the range holdings values and leave every other holding at zero', () => {
    const record = flopEndRecord(flop, network, 4, meta)
    expect(record.board).toEqual([...flop.board.map(cardKey), 255, 255])
    expect(record.ranges[1][index('Kc Qh')]).toBeCloseTo(3 / 6, 6)
    for (const player of [0, 1] as const) {
      const held = new Set(
        flop.ranges[player].map((c) => comboIndex52(cardKey(c.hole[0]), cardKey(c.hole[1]))),
      )
      expect(record.ranges[player].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6)
      record.values[player].forEach((value, at) => {
        if (!held.has(at)) expect(value).toBe(0)
      })
      for (const at of held) expect(Number.isFinite(record.values[player][at])).toBe(true)
    }
  })

  it('draw the same turn cards from the same seed, and other ones from another', () => {
    const first = flopEndRecord(flop, network, 4, meta)
    const again = flopEndRecord(flop, network, 4, meta)
    const other = flopEndRecord(flop, network, 4, { ...meta, seed: 'flop-test:0:1' })
    expect([...again.values[0]]).toEqual([...first.values[0]])
    expect([...other.values[0]]).not.toEqual([...first.values[0]])
  })

  it('solve every turn card when asked for all of them or for more than there are', () => {
    const all = flopEndRecord(flop, network, 0, meta)
    const more = flopEndRecord(flop, network, 60, { ...meta, seed: 'another' })
    expect([...more.values[1]]).toEqual([...all.values[1]])
  }, 60_000)

  it('refuse a board that is not a flop, and fewer than three turn cards', () => {
    expect(() => flopEndRecord(flop, network, 2, meta)).toThrow(/three turn cards/)
    expect(() => flopEndRecord({ ...flop, board: cards('Ah Kd 7s 4c') }, network, 4, meta)).toThrow(
      /three board cards/,
    )
  })
})

describe('records checked against answers worked out another way', () => {
  it('give each holding its showdown share over every turn and river when nobody bets', () => {
    // A network that adds nothing to the checked-down value and a turn with only checks: a
    // holding is then worth exactly its share of the pot over every turn and river it can meet.
    const last = network.layers.length - 1
    const neutral: RiverValueNetwork = {
      ...network,
      checked: { inputs: false },
      layers: network.layers.map((layer, index) =>
        index === last
          ? {
              ...layer,
              weight: new Float32Array(layer.weight.length),
              bias: new Float32Array(layer.bias.length),
            }
          : layer,
      ),
    }
    const spot: RiverSpot = { ...flop, ranges: [[combo('Qc Jc')], [combo('Kc Qh')]] }
    const record = flopEndRecord(spot, neutral, 0, meta, {
      betSizes: [],
      maxRaises: 0,
      allIn: false,
    })
    const blocked = new Set([...flop.board, ...cards('Qc Jc Kc Qh')].map(cardKey))
    const live = makeDeck().filter((card) => !blocked.has(cardKey(card)))
    let won = 0
    let seen = 0
    for (let a = 0; a < live.length; a += 1) {
      for (let b = a + 1; b < live.length; b += 1) {
        const board = [...flop.board, live[a] as Card, live[b] as Card]
        const mine = handScore([...cards('Qc Jc'), ...board])
        const theirs = handScore([...cards('Kc Qh'), ...board])
        won += mine > theirs ? 1 : mine === theirs ? 0.5 : 0
        seen += 1
      }
    }
    expect(record.values[0][index('Qc Jc')]).toBeCloseTo(won / seen, 5)
    expect(record.values[1][index('Kc Qh')]).toBeCloseTo(1 - won / seen, 5)
  }, 60_000)
})
