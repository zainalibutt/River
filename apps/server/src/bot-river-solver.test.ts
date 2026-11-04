import { type Card, makeDeck, mulberry32, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  bestResponseValue,
  type CfrOptions,
  prepare,
  type RangeCombo,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  riverReport,
  riverTerminalEvaluator,
  riverValues,
  type ShowdownValues,
  solveRiver as solveRiverBase,
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
  it('reuses terminal scratch across seats, reaches and fold/showdown payoffs', () => {
    const board = cards('Ah Kd 7s 4c 2h')
    const hands = [
      prepare(randomRange(board, 23, 5), board),
      prepare(randomRange(board, 19, 6), board),
    ] as const
    const settle = riverTerminalEvaluator(hands, 100)
    const nodes = [
      { kind: 'showdown', paid: [40, 40] },
      { kind: 'fold', folder: 0, paid: [30, 90] },
      { kind: 'fold', folder: 1, paid: [90, 30] },
    ] as const
    const saved = settle(nodes[0], 0, hands[1].weights)
    const snapshot = [...saved]
    for (const p of [0, 1, 0] as const) {
      const other = p === 0 ? 1 : 0
      const reach = hands[other].weights.map((w, h) => w * (h % 3))
      for (const node of nodes) {
        const values = settle(node, p, reach)
        hands[p].combos.forEach((mine, h) => {
          let expected = 0
          hands[other].combos.forEach((theirs, o) => {
            if (
              mine.hole.some((a) => theirs.hole.some((b) => a.rank === b.rank && a.suit === b.suit))
            )
              return
            const diff = (hands[p].strength[h] as number) - (hands[other].strength[o] as number)
            const share =
              node.kind === 'fold' ? Number(node.folder !== p) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5
            expected +=
              (reach[o] as number) * (share * (100 + node.paid[0] + node.paid[1]) - node.paid[p])
          })
          expect(values[h]).toBeCloseTo(expected, 9)
        })
      }
    }
    expect([...saved]).toEqual(snapshot)
  })

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

describe.each(['cfr+', 'dcfr'] as const)('%s solving', (scheme) => {
  const solveRiver = (...args: Parameters<typeof solveRiverBase>) => {
    args[6] = { scheme }
    return solveRiverBase(...args)
  }
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

    it('DCFR beats CFR+ at 25 iterations on the polarised game', () => {
      const plus = riverReport(solveRiverBase(polarised, 25)).exploitability
      const discounted = riverReport(
        solveRiverBase(polarised, 25, undefined, undefined, undefined, undefined, {
          scheme: 'dcfr',
        }),
      ).exploitability
      expect(discounted).toBeLessThan(plus * 0.9)
    })

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

  describe('safe re-solving with promises', () => {
    const board = cards('Ah Kd 7s 4c 2h')
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 300,
      ranges: [randomRange(board, 40, 11), randomRange(board, 40, 12)],
      betSizes: [0.5, 1],
      allIn: true,
      maxRaises: 2,
    }
    const flat = (range: readonly RangeCombo[]) => range.map((entry) => ({ ...entry, weight: 1 }))
    // How much the opponent's best counter takes from player 0's play, with the true ranges.
    const exposed = (solved: RiverSolution) =>
      bestResponseValue({ tree: solved.tree, strategy: solved.strategy, spot }, 1) / spot.pot

    it('plays as safely as the solve that knew the range, without being told the range', () => {
      const full = solveRiver(spot, 600)
      const promises = riverValues(full).values[1]
      const resolved = solveRiver(
        { ...spot, ranges: [spot.ranges[0], flat(spot.ranges[1])] },
        600,
        undefined,
        undefined,
        {
          player: 1,
          promises,
        },
      )
      // A confident wrong read: almost all the weight on a quarter of the holdings.
      const misread = spot.ranges[1].map((entry, index) => ({
        ...entry,
        weight: index < 10 ? 1 : 0.01,
      }))
      const guessed = solveRiver({ ...spot, ranges: [spot.ranges[0], misread] }, 600)
      expect(exposed(resolved)).toBeLessThan(exposed(full) + 0.01)
      expect(exposed(guessed)).toBeGreaterThan(exposed(resolved) + 0.01)
      expect(resolved.followShare).toHaveLength(spot.ranges[1].length)
    })

    it('refuses promises together with an opponent model, and promises of the wrong length', () => {
      const model = { player: 1 as const, weight: 0.5, strategy: () => new Float64Array(0) }
      const promises = new Float64Array(spot.ranges[1].length)
      expect(() => solveRiver(spot, 10, model, undefined, { player: 1, promises })).toThrow(
        /not both/,
      )
      expect(() =>
        solveRiver(spot, 10, undefined, undefined, { player: 1, promises: new Float64Array(3) }),
      ).toThrow(/one promise per holding/)
    })
  })
})

it.each([{}, { alpha: 0.7, beta: -0.4, gamma: 1.2 }])(
  'matches a scalar signed-regret and discounted-average oracle: %j',
  (parameters: CfrOptions) => {
    const alpha = parameters.alpha ?? 1.5
    const beta = parameters.beta ?? 0
    const gamma = parameters.gamma ?? 2
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c 2h'),
      pot: 100,
      stack: 1000,
      ranges: [[combo('8s 8h')], [combo('7c 7d')]],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const tree: RiverNode = {
      kind: 'action',
      player: 0,
      history: '',
      paid: [0, 0],
      actions: ['L', 'R'],
      children: [0, 1].map((a) => ({ kind: 'showdown', paid: [a, a] })),
    }
    const utilities = [
      [3, 0],
      [0, 4],
      [3, 0],
      [0, 4],
      [1, 0],
      [0, 2],
    ]
    const regrets = [0, 0]
    let expectedLeft = 0
    let normalizer = 0
    const expectedVisits: number[] = []
    utilities.forEach((payoffs, index) => {
      const t = index + 1
      const positive = regrets.map((r) => Math.max(0, r))
      const total = (positive[0] as number) + (positive[1] as number)
      const left = total > 0 ? (positive[0] as number) / total : 0.5
      expectedVisits.push(left)
      normalizer += t ** gamma
      const value = left * (payoffs[0] as number) + (1 - left) * (payoffs[1] as number)
      for (let a = 0; a < 2; a += 1) {
        const accumulated = (regrets[a] as number) + (payoffs[a] as number) - value
        const power = t ** (accumulated >= 0 ? alpha : beta)
        regrets[a] = (accumulated * power) / (power + 1)
      }
      // Player 1 sees player 0 after this update. Its traversal samples
      // player 0's average strategy, while the learning visits remain above.
      const next = regrets.map((r) => Math.max(0, r))
      const nextTotal = (next[0] as number) + (next[1] as number)
      const sampledLeft = nextTotal > 0 ? (next[0] as number) / nextTotal : 0.5
      // Closed form after T: the common (T+1)^-gamma cancels.
      expectedLeft += t ** gamma * sampledLeft
    })
    let iteration = -1
    const visits: number[] = []
    const values: ShowdownValues = (node, player, _hands, self, _opponent, out) => {
      if (player === 0 && node.paid[0] === 0) {
        iteration += 1
        visits.push(self[0] as number)
      }
      out.fill(player === 0 ? (utilities[iteration]?.[node.paid[0]] as number) : 0)
    }
    const result = solveRiverBase(spot, utilities.length, undefined, values, undefined, tree, {
      scheme: 'dcfr',
      ...parameters,
    })
    visits.forEach((v, i) => {
      expect(v).toBeCloseTo(expectedVisits[i] as number, 12)
    })
    expect(result.strategy.get('')?.[0]).toBeCloseTo(expectedLeft / normalizer, 12)

    // The opt-out information set must use the same signed regrets and weights.
    const payoffs = [3, 0, 2, 0, 3, 0]
    const gadgetRegrets = [0, 0]
    let expectedFollow = 0
    payoffs.forEach((played, index) => {
      const t = index + 1
      const up = Math.max(0, gadgetRegrets[0] as number)
      const down = Math.max(0, gadgetRegrets[1] as number)
      const follow = up + down > 0 ? up / (up + down) : 0.5
      expectedFollow += t ** gamma * follow
      const value = follow * played + (1 - follow) * 1.5
      for (const [a, payoff] of [played, 1.5].entries()) {
        const accumulated = (gadgetRegrets[a] as number) + payoff - value
        const power = t ** (accumulated >= 0 ? alpha : beta)
        gadgetRegrets[a] = (accumulated * power) / (power + 1)
      }
    })
    let sample = 0
    const gadgetValues: ShowdownValues = (_node, player, _hands, _self, _opponent, out) => {
      out.fill(player === 1 ? (payoffs[sample++] as number) : 0)
    }
    const gadget = solveRiverBase(
      spot,
      payoffs.length,
      undefined,
      gadgetValues,
      { player: 1, promises: Float64Array.of(1.5) },
      { kind: 'showdown', paid: [0, 0] },
      { scheme: 'dcfr', ...parameters },
    )
    expect(gadget.followShare?.[0]).toBeCloseTo(expectedFollow / normalizer, 12)
  },
)
