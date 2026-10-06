import { readFileSync } from 'node:fs'
import { type Card, cardKey, handScore, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  prepare,
  type RangeCombo,
  type RiverOpponentModel,
  type RiverSpot,
  solveRiver,
  terminal,
} from './bot-river-solver.js'
import { turnRivers } from './bot-turn-end-data.js'
import { allInShowdown, solveTurn, turnShowdown } from './bot-turn-solver.js'
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

describe('the closed-betting hook', () => {
  it('changes nothing when it values showdowns as the river does', () => {
    const spot: RiverSpot = {
      board: cards('Qs 9h 6d 3c 2s'),
      pot: 100,
      stack: 300,
      ranges: [
        [combo('As Ks'), combo('9c 9d', 2), combo('7h 8h'), combo('Qc Jc')],
        [combo('Qd Td'), combo('6h 6c'), combo('Ah 5h', 2), combo('4c 5c')],
      ],
      betSizes: [0.5, 1],
      allIn: true,
      maxRaises: 2,
    }
    const plain = solveRiver(spot, 50)
    const hooked = solveRiver(
      spot,
      50,
      undefined,
      (node, traverser, hands, _self, opponent, out) => {
        out.set(terminal(node, traverser, hands, opponent, spot.pot))
      },
    )
    expect([...hooked.strategy.keys()]).toEqual([...plain.strategy.keys()])
    for (const [history, table] of plain.strategy) {
      expect([...(hooked.strategy.get(history) ?? [])]).toEqual([...table])
    }
  })
})

describe('an all-in on the turn', () => {
  it('is the showdown averaged over every river card the two holdings leave', () => {
    const board = cards('Ah Kd 7s 4c')
    const ranges: [RangeCombo[], RangeCombo[]] = [
      [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d')],
      [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c')],
    ]
    const hands = [prepare(ranges[0], board), prepare(ranges[1], board)] as const
    const showdown = allInShowdown(turnRivers(board), hands)
    const total = 600
    const mine = 250
    const out = new Float64Array(hands[0].combos.length)
    showdown(0, hands[1].weights, total, mine, out)
    hands[0].combos.forEach((held, h) => {
      let expected = 0
      for (const [o, theirs] of hands[1].combos.entries()) {
        const used = new Set([...held.hole, ...theirs.hole].map(cardKey))
        if (used.size < 4) continue
        let sum = 0
        for (const river of makeDeck()) {
          const key = cardKey(river)
          if (used.has(key) || board.some((card) => cardKey(card) === key)) continue
          const ours = handScore([...held.hole, ...board, river])
          const them = handScore([...theirs.hole, ...board, river])
          sum += ours > them ? total - mine : ours < them ? -mine : total / 2 - mine
        }
        expected += (hands[1].weights[o] as number) * (sum / 44)
      }
      // The pairings' win shares are kept in single precision: a part in ten million.
      expect(Math.abs((out[h] as number) - expected)).toBeLessThan(1e-7 * total)
    })
  })
})

describe('a turn solved with a network valuing the river', () => {
  it('gives every holding a strategy, and the same one each time', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
    ) as ValueNetworkDescription & { weights: number[] }
    const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
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
    const first = solveTurn(spot, 30, network)
    const again = solveTurn(spot, 30, network)
    expect(first.strategy.size).toBeGreaterThan(1)
    for (const [history, table] of first.strategy) {
      expect([...(again.strategy.get(history) ?? [])]).toEqual([...table])
      const width = table.length / 4
      for (let h = 0; h < 4; h += 1) {
        let sum = 0
        for (let a = 0; a < width; a += 1) sum += table[h * width + a] as number
        expect(sum).toBeCloseTo(1, 9)
      }
    }
  })
})

describe('a turn solved against an opponent with known habits', () => {
  it('takes the reads model the river solver takes, and still gives every holding a strategy', () => {
    const fixture = JSON.parse(
      readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
    ) as ValueNetworkDescription & { weights: number[] }
    const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
      pot: 100,
      stack: 400,
      ranges: [
        [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d'), combo('As 2s')],
        [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c'), combo('Th Jh')],
      ],
      betSizes: [0.66],
      allIn: true,
      maxRaises: 1,
    }
    // The opponent, in position, never bets: every row puts all its weight on the first action.
    const passive: RiverOpponentModel = {
      player: 1,
      weight: 1,
      strategy: (node, hands) => {
        const width = node.actions.length
        const rows = new Float64Array(hands.combos.length * width)
        for (let h = 0; h < hands.combos.length; h += 1) rows[h * width] = 1
        return rows
      },
    }
    const solution = solveTurn(spot, 30, network, passive)
    for (const table of solution.strategy.values()) {
      const width = table.length / 4
      for (let h = 0; h < 4; h += 1) {
        let sum = 0
        for (let a = 0; a < width; a += 1) sum += table[h * width + a] as number
        expect(sum).toBeCloseTo(1, 9)
      }
    }
  })
})

describe('a turn-end network that learns what betting adds', () => {
  it('values a closed turn with chips behind as the hand checked down when it adds nothing', () => {
    const board = cards('Ah Kd 7s 4c')
    const ranges: [RangeCombo[], RangeCombo[]] = [
      [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d')],
      [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c')],
    ]
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 400,
      ranges,
      betSizes: [0.66],
      allIn: true,
      maxRaises: 1,
    }
    const buckets = 8
    // A network whose every output is nought: each holding is worth its checked-down value.
    const network: RiverValueNetwork = {
      buckets,
      layers: [
        {
          weight: new Float32Array(2 * buckets * (3 * buckets + 1)),
          bias: new Float32Array(2 * buckets),
          rows: 2 * buckets,
          columns: 3 * buckets + 1,
          slope: null,
        },
      ],
      checked: { inputs: false },
    }
    const hands = [prepare(ranges[0], board), prepare(ranges[1], board)] as const
    const leaf = turnShowdown(spot, network)
    const checkedDown = allInShowdown(turnRivers(board), hands)
    const node = { kind: 'showdown', paid: [100, 100] } as const
    for (const traverser of [0, 1] as const) {
      const other = traverser === 0 ? 1 : 0
      const out = new Float64Array(hands[traverser].combos.length)
      const expected = new Float64Array(hands[traverser].combos.length)
      leaf(node, traverser, hands, hands[traverser].weights, hands[other].weights, out)
      checkedDown(traverser, hands[other].weights, 300, 100, expected)
      expected.forEach((value, h) => {
        expect(out[h]).toBeCloseTo(value, 3)
      })
    }
  })
})
