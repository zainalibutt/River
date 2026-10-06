import { type Card, makeDeck, mulberry32, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  prepare,
  type RangeCombo,
  type RiverSpot,
  riverReport,
  riverValues,
  solveRiver,
  strategyRows,
  terminal,
} from './bot-river-solver.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})

function randomRange(board: readonly Card[], count: number, seed: number): RangeCombo[] {
  const random = mulberry32(seed)
  const used = new Set(board.map((card) => `${card.rank}${card.suit}`))
  const deck = makeDeck().filter((card) => !used.has(`${card.rank}${card.suit}`))
  const range: RangeCombo[] = []
  const seen = new Set<string>()
  while (range.length < count) {
    const a = deck[Math.floor(random() * deck.length)] as Card
    const b = deck[Math.floor(random() * deck.length)] as Card
    const key = [`${a.rank}${a.suit}`, `${b.rank}${b.suit}`].sort().join('')
    if (a === b || seen.has(key)) continue
    seen.add(key)
    range.push({ hole: [a, b], weight: 0.2 + random() })
  }
  return range
}

describe('river showdowns', () => {
  it('match a brute-force count of every compatible pair', () => {
    const board = cards('Ah Kd 7s 4c 2h')
    const hero = prepare(randomRange(board, 60, 1), board)
    const villain = prepare(randomRange(board, 70, 2), board)
    const random = mulberry32(3)
    const reach = Float64Array.from(villain.weights, () => random())
    const node = { kind: 'showdown' as const, paid: [40, 40] as const }
    const fast = terminal(node, 0, [hero, villain], reach, 100)
    const total = 100 + 80
    hero.combos.forEach((mine, h) => {
      let expected = 0
      villain.combos.forEach((theirs, o) => {
        const clash = mine.hole.some((a) =>
          theirs.hole.some((b) => a.rank === b.rank && a.suit === b.suit),
        )
        if (clash) return
        const diff = (hero.strength[h] as number) - (villain.strength[o] as number)
        const payoff = diff > 0 ? total - 40 : diff < 0 ? -40 : total / 2 - 40
        expected += (reach[o] as number) * payoff
      })
      expect(fast[h]).toBeCloseTo(expected, 9)
    })
  })
})

describe('river solving', () => {
  const polarised: RiverSpot = {
    board: cards('Ah Kd 7s 4c 2h'),
    pot: 100,
    stack: 1_000,
    ranges: [[combo('8s 8h')], [combo('7c 7d'), combo('7h 7d'), combo('5c 6d'), combo('5d 6c')]],
    betSizes: [1],
    allIn: false,
    maxRaises: 0,
  }

  it('bluffs at the pot odds and defends at the minimum defence frequency', () => {
    const solution = solveRiver(polarised, 3_000)
    const opening = strategyRows(solution, '')?.[0]
    expect(opening?.[0]).toBeGreaterThan(0.99)
    const inPosition = strategyRows(solution, 'k')
    if (inPosition === undefined) throw new Error('no in-position strategy')
    // Rows follow the range after board blocking: two value hands, then two air hands.
    expect(inPosition[0]?.[1]).toBeGreaterThan(0.99)
    expect(inPosition[1]?.[1]).toBeGreaterThan(0.99)
    expect((inPosition[2]?.[1] ?? 0) + (inPosition[3]?.[1] ?? 0)).toBeCloseTo(1, 1)
    const facing = strategyRows(solution, 'kb100')?.[0]
    expect(facing?.[1]).toBeCloseTo(0.5, 1)
    expect(riverReport(solution).exploitability).toBeLessThan(0.005)
  }, 30_000)

  it('keeps each decision in one table, a row per combo that sums to one', () => {
    const solution = solveRiver(polarised, 50)
    const table = solution.strategy.get('k')
    const rows = strategyRows(solution, 'k') ?? []
    expect(table).toBeInstanceOf(Float64Array)
    expect(rows).toHaveLength(4)
    expect(table?.length).toBe(rows.length * (rows[0]?.length ?? 0))
    for (const row of rows) expect(row.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12)
  })

  it('gets less exploitable with training on a full-width river', () => {
    const board = cards('Qs 9h 6d 3c 2s')
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 300,
      ranges: [randomRange(board, 300, 4), randomRange(board, 300, 5)],
      betSizes: [0.5, 1],
      allIn: true,
      maxRaises: 1,
    }
    const early = riverReport(solveRiver(spot, 20)).exploitability
    const late = riverReport(solveRiver(spot, 300)).exploitability
    expect(late).toBeLessThan(early / 2)
    expect(late).toBeLessThan(0.05)
  }, 120_000)
})

describe('exploiting a known opponent', () => {
  // The first player holds either the nuts or nothing; the second a bluff-catcher or air.
  const spot: RiverSpot = {
    board: cards('Ah Kd 7s 4c 2h'),
    pot: 100,
    stack: 1000,
    ranges: [
      [combo('7c 7d'), combo('6h 5h')],
      [combo('As Ks'), combo('9c 8c')],
    ],
    betSizes: [1],
    allIn: false,
    maxRaises: 0,
  }
  // A calling station: never bets, always calls.
  const station = {
    player: 1 as const,
    weight: 1,
    strategy: (
      node: { readonly actions: readonly string[] },
      hands: { readonly combos: readonly unknown[] },
    ) =>
      Float64Array.from({ length: hands.combos.length * node.actions.length }, (_, index) => {
        const action = node.actions[index % node.actions.length]
        return action === 'k' || action === 'c' ? 1 : 0
      }),
  }
  const betShare = (solution: ReturnType<typeof solveRiver>, hand: number) =>
    strategyRows(solution, '')?.[hand]?.[1] ?? Number.NaN

  it('never bluffs a calling station and bets its winners', () => {
    const solution = solveRiver(spot, 3_000, station)
    expect(betShare(solution, 0)).toBeGreaterThan(0.99)
    expect(betShare(solution, 1)).toBeLessThan(0.01)
  })

  it('bluffs at the balanced rate against an opponent left to play freely', () => {
    const balanced = solveRiver(spot, 3_000, { ...station, weight: 0 })
    const plain = solveRiver(spot, 3_000)
    expect(betShare(balanced, 1)).toBeCloseTo(0.5, 1)
    expect(strategyRows(balanced, '')?.[1]?.[1]).toBe(strategyRows(plain, '')?.[1]?.[1])
  })
})

describe("every holding's value", () => {
  it('pays the pot to the better hand when the river can only be checked down', () => {
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c 2h'),
      pot: 100,
      stack: 1_000,
      ranges: [[combo('8s 8h')], [combo('7c 7d')]],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const { values } = riverValues(solveRiver(spot, 10))
    expect([...values[0]]).toEqual([0])
    expect([...values[1]]).toEqual([100])
  })

  it("averages to each player's value per deal, and the two add up to the pot", () => {
    // One player holds only clubs and spades, the other only hearts and
    // diamonds, so no holdings clash and every pairing is equally possible.
    const board = cards('Qs 9h 6d 3c 2s')
    const used = new Set(board.map((card) => `${card.rank}${card.suit}`))
    const random = mulberry32(9)
    const rangeOf = (suits: string): RangeCombo[] => {
      const deck = makeDeck().filter(
        (card) => suits.includes(card.suit) && !used.has(`${card.rank}${card.suit}`),
      )
      const range: RangeCombo[] = []
      for (let a = 0; a < deck.length; a += 1) {
        for (let b = a + 1; b < deck.length; b += 1) {
          range.push({ hole: [deck[a] as Card, deck[b] as Card], weight: 0.1 + random() })
        }
      }
      return range
    }
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 400,
      ranges: [rangeOf('cs'), rangeOf('hd')],
      betSizes: [0.5, 1],
      allIn: true,
      maxRaises: 2,
    }
    const solution = solveRiver(spot, 100)
    const report = riverReport(solution)
    const { hands, values } = riverValues(solution)
    for (const player of [0, 1] as const) {
      let weighted = 0
      let total = 0
      hands[player].weights.forEach((weight, h) => {
        weighted += weight * (values[player][h] as number)
        total += weight
      })
      expect(weighted / total).toBeCloseTo(report.value[player], 6)
      for (const value of values[player]) {
        expect(value).toBeGreaterThanOrEqual(-spot.stack)
        expect(value).toBeLessThanOrEqual(spot.pot + spot.stack)
      }
    }
    expect(report.value[0] + report.value[1]).toBeCloseTo(spot.pot, 6)
  }, 60_000)
})
