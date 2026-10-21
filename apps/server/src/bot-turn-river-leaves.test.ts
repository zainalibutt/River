import { type Card, cardKey, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  prepare,
  type RangeCombo,
  type RiverNode,
  type RiverSpot,
  riverValues,
  type ShowdownValues,
  solveRiver as solveRiverBase,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { turnEndValues, turnRivers } from './bot-turn-end-data.js'
import {
  carriedRiverPromises,
  createRiverPromiseRecord,
  perRiverShowdown,
  type RiverLeafEvaluator,
} from './bot-turn-river-leaves.js'
import { allInShowdown } from './bot-turn-solver.js'
import { type RiverValueNetwork, riverHoldingValues } from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const index = (held: RangeCombo) => comboIndex52(cardKey(held.hole[0]), cardKey(held.hole[1]))
const key = (text: string) => cardKey(parseCard(text))
const spotOf = (): RiverSpot => ({
  board: cards('Ah Kd 7s 4c'),
  pot: 100,
  stack: 300,
  ranges: [
    [combo('Ac Qc', 2), combo('8h 8d', 0.5), combo('5c 6c')],
    [combo('As Qd', 3), combo('Kc Qc'), combo('6h 5h', 2)],
  ],
  betSizes: [0.3],
  allIn: false,
  maxRaises: 0,
})
const handsOf = (spot: RiverSpot) =>
  [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
const half: RiverLeafEvaluator = () => [
  new Float64Array(COMBOS).fill(0.5),
  new Float64Array(COMBOS).fill(0.5),
]
const meets = (a: RangeCombo, b: RangeCombo) =>
  new Set([...a.hole, ...b.hole].map(cardKey)).size === 4

describe.each(['cfr+', 'dcfr'] as const)('%s averaging', (scheme) => {
  const solveRiver = (...args: Parameters<typeof solveRiverBase>) => {
    args[6] = { scheme }
    return solveRiverBase(...args)
  }
  describe('per-river turn leaves', () => {
    it('matches an independent (holding, opponent, river) enumeration at fixed reaches', () => {
      const spot = spotOf()
      const hands = handsOf(spot)
      const reaches = [Float64Array.of(0.25, 1.75, 0), Float64Array.of(2, 0.5, 3)] as const
      let queries = 0
      const fake: RiverLeafEvaluator = (river) => {
        queries += 1
        const c = cardKey(river.board[4] as Card)
        for (const range of river.ranges) {
          expect(range.every((h) => !h.hole.some((card) => cardKey(card) === c))).toBe(true)
        }
        const squares = river.ranges.map((range) =>
          range.reduce((sum, h) => sum + h.weight ** 2, 0),
        )
        const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
        for (const player of [0, 1] as const) {
          for (let h = 0; h < COMBOS; h += 1) {
            out[player][h] =
              0.1 +
              0.003 * c +
              0.0001 * h +
              0.01 * (squares[0] as number) +
              0.02 * (squares[1] as number) +
              player * 0.2
          }
        }
        return out
      }
      const hook = perRiverShowdown(spot, fake)
      for (const player of [0, 1] as const) {
        const other = player === 0 ? 1 : 0
        const out = new Float64Array(hands[player].combos.length)
        hook(
          { kind: 'showdown', paid: [30, 30] },
          player,
          hands,
          reaches[player],
          reaches[other],
          out,
        )
        hands[player].combos.forEach((held, h) => {
          let expected = 0
          hands[other].combos.forEach((opponent, o) => {
            if (!meets(held, opponent)) return
            const blocked = new Set([...spot.board, ...held.hole, ...opponent.hole].map(cardKey))
            let count = 0
            for (const river of makeDeck()) {
              const c = cardKey(river)
              if (blocked.has(c)) continue
              count += 1
              const squares = hands.map((side, p) =>
                side.combos.reduce(
                  (sum, holding, at) =>
                    sum +
                    (holding.hole.some((card) => cardKey(card) === c)
                      ? 0
                      : (reaches[p as 0 | 1][at] as number) ** 2),
                  0,
                ),
              )
              const value =
                0.1 +
                0.003 * c +
                0.0001 * index(held) +
                0.01 * (squares[0] as number) +
                0.02 * (squares[1] as number) +
                player * 0.2
              expected += ((reaches[other][o] as number) * (value * 160 - 30)) / 44
            }
            expect(count).toBe(44)
          })
          expect(out[h]).toBeCloseTo(expected, 10)
        })
      }
      expect(queries).toBe(96)
    })

    it('uses the river network with the same card-restricted inputs as riverHoldingValues', () => {
      const spot = spotOf()
      const network: RiverValueNetwork = {
        buckets: 2,
        layers: [
          {
            rows: 4,
            columns: 7,
            slope: null,
            weight: Float32Array.from({ length: 28 }, (_, i) => ((i % 5) - 2) / 10),
            bias: Float32Array.of(0.1, 0.2, 0.3, 0.4),
          },
        ],
      }
      const hands = handsOf(spot)
      const networkHook = perRiverShowdown(spot, network)
      const evaluatorHook = perRiverShowdown(spot, (river, ranks) =>
        riverHoldingValues(network, river, ranks),
      )
      for (const player of [0, 1] as const) {
        const other = player === 0 ? 1 : 0
        const a = new Float64Array(hands[player].combos.length)
        const b = new Float64Array(a.length)
        const node = { kind: 'showdown' as const, paid: [30, 30] as const }
        networkHook(node, player, hands, hands[player].weights, hands[other].weights, a)
        evaluatorHook(node, player, hands, hands[player].weights, hands[other].weights, b)
        for (let h = 0; h < a.length; h += 1) {
          expect(Math.abs((a[h] as number) - (b[h] as number)) / 160).toBeLessThanOrEqual(1e-5)
        }
      }
    })

    it('matches unbatched real-shaped random networks on random and zero reaches', () => {
      let seed = 8173
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
      const network: RiverValueNetwork = {
        buckets: 128,
        layers: [385, 512, 512, 512].map((columns, i) => {
          const rows = i === 3 ? 256 : 512
          return {
            columns,
            rows,
            weight: Float32Array.from(
              { length: rows * columns },
              () => (random() - 0.5) / Math.sqrt(columns),
            ),
            bias: Float32Array.from({ length: rows }, () => random() - 0.5),
            slope: i === 3 ? null : 0.2,
          }
        }),
      }
      const spot = spotOf()
      const deck = makeDeck().filter(
        (card) => !spot.board.some((c) => cardKey(c) === cardKey(card)),
      )
      const range: RangeCombo[] = []
      for (let i = 0; i < deck.length; i += 1) {
        for (let j = i + 1; j < deck.length; j += 1) {
          if (random() < 0.3)
            range.push({ hole: [deck[i] as Card, deck[j] as Card], weight: random() })
        }
      }
      const fullSpot = { ...spot, ranges: [range, range.slice(5)] as const }
      const hands = handsOf(fullSpot)
      const batch = perRiverShowdown(fullSpot, network)
      const scalar = perRiverShowdown(fullSpot, (river, ranks) =>
        riverHoldingValues(network, river, ranks),
      )
      for (let trial = 0; trial < 3; trial += 1) {
        for (const player of [0, 1] as const) {
          const other = player === 0 ? 1 : 0
          const self = Float64Array.from(hands[player].weights, () => (trial === 1 ? 0 : random()))
          const opponent = Float64Array.from(hands[other].weights, () =>
            trial === 2 ? 0 : random(),
          )
          const a = new Float64Array(self.length)
          const b = new Float64Array(self.length)
          const node = { kind: 'showdown' as const, paid: [30, 30] as const }
          batch(node, player, hands, self, opponent, a)
          scalar(node, player, hands, self, opponent, b)
          let difference = 0
          for (let h = 0; h < a.length; h += 1)
            difference = Math.max(difference, Math.abs((a[h] as number) - (b[h] as number)) / 160)
          expect(difference).toBeLessThanOrEqual(1e-5)
        }
      }
    })

    it('matches turnEndValues with a solved river on every card, including paid chips', () => {
      const spot = spotOf()
      const hands = handsOf(spot)
      const exact: RiverLeafEvaluator = (river) => {
        const solved = riverValues(solveRiver(river, 40))
        const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
        for (const player of [0, 1] as const) {
          solved.hands[player].combos.forEach((held, h) => {
            out[player][index(held)] = (solved.values[player][h] as number) / river.pot
          })
        }
        return out
      }
      const values = turnEndValues({ ...spot, pot: 160, stack: 270 }, turnRivers(spot.board), exact)
      const hook = perRiverShowdown(spot, exact)
      for (const player of [0, 1] as const) {
        const other = player === 0 ? 1 : 0
        const out = new Float64Array(hands[player].combos.length)
        hook(
          { kind: 'showdown', paid: [30, 30] },
          player,
          hands,
          hands[player].weights,
          hands[other].weights,
          out,
        )
        hands[player].combos.forEach((held, h) => {
          const mass = hands[other].combos.reduce(
            (sum, o) => sum + (meets(held, o) ? o.weight : 0),
            0,
          )
          expect(out[h]).toBeCloseTo(mass * ((values[player][index(held)] as number) * 160 - 30), 9)
        })
      }
    })

    it('records nonlinear iteration CFVs rather than querying the averaged range', () => {
      const base = spotOf()
      const spot: RiverSpot = {
        ...base,
        ranges: [[combo('Ac Qc'), combo('8h 8d')], [combo('As Qd')]],
      }
      const hands = handsOf(spot)
      const a = index(hands[0].combos[0] as RangeCombo)
      const o = index(hands[1].combos[0] as RangeCombo)
      const nonlinear: RiverLeafEvaluator = (river) => {
        const range = river.ranges[0]
        const total = range.reduce((sum, h) => sum + h.weight, 0)
        const x = total > 0 ? (range.find((h) => index(h) === a)?.weight ?? 0) / total : 0
        return [new Float64Array(COMBOS), new Float64Array(COMBOS).fill(Math.max(0, x - 0.5))]
      }
      const record = createRiverPromiseRecord()
      const hook = perRiverShowdown(spot, nonlinear, record)
      const node = { kind: 'showdown' as const, paid: [0, 0] as const }
      const out = [new Float64Array(2), new Float64Array(1)] as const
      for (const t of [1, 2, 3]) {
        const reach = Float64Array.from(t === 2 ? [2, 0] : [0, 2])
        const visit =
          scheme === 'cfr+'
            ? { history: 'kk', weight: t }
            : { history: 'kk', weight: (t / (t + 1)) ** 2, discount: (t / (t + 1)) ** 2 }
        hook(node, 0, hands, reach, hands[1].weights, out[0], visit)
        hook(node, 1, hands, hands[1].weights, reach, out[1], visit)
      }
      const carried = carriedRiverPromises(record, 'kk', key('2d'), 0)
      const recent = scheme === 'cfr+' ? 2 / 6 : 4 / 14
      expect(carried.cfvs[o]).toBeCloseTo(recent * 100, 12)
      expect(carried.promises[o]).toBeCloseTo(recent / 2, 12)
      expect(carried.reach[a]).toBeCloseTo(2 * recent, 12)
      const finalRanges: RiverSpot = {
        ...spot,
        board: [...spot.board, parseCard('2d')],
        ranges: [[combo('Ac Qc', 2 * recent), combo('8h 8d', 2 * (1 - recent))], spot.ranges[1]],
      }
      const requeried = nonlinear(finalRanges, new Uint16Array(COMBOS))[1][o] as number
      expect(requeried).toBeCloseTo(Math.max(0, recent - 0.5), 12)
      expect(carried.promises[o]).not.toBeCloseTo(requeried, 6)
    })

    it.each([undefined, 0, 1] as const)(
      'carries average realization reach with gadget player %s',
      (gadgetPlayer) => {
        const spot = { ...spotOf(), maxRaises: 1 }
        const record = createRiverPromiseRecord()
        const hook = perRiverShowdown(spot, half, record)
        const visits = new Map<string, number[]>()
        const traced: ShowdownValues = (...args) => {
          const visit = args[6]
          if (args[1] === 0 && visit !== undefined) {
            const weights = visits.get(visit.history) ?? []
            weights.push(visit.weight)
            visits.set(visit.history, weights)
          }
          hook(...args)
        }
        const gadget =
          gadgetPlayer === undefined
            ? undefined
            : {
                player: gadgetPlayer,
                promises: new Float64Array(spot.ranges[gadgetPlayer].length).fill(50),
              }
        const solution = solveRiver(spot, 4, undefined, traced, gadget)
        expect([...visits.keys()].sort()).toEqual(['b30b78c', 'b30c', 'kb30b78c', 'kb30c', 'kk'])
        for (const weights of visits.values())
          expect(weights).toEqual(
            scheme === 'cfr+' ? [1, 2, 3, 4] : [1, 2, 3, 4].map((t) => (t / (t + 1)) ** 2),
          )
        const hands = handsOf(spot)
        const check = (
          node: RiverNode,
          history: string,
          reach: readonly [Float64Array, Float64Array],
        ) => {
          if (node.kind === 'fold') return
          if (node.kind === 'showdown') {
            for (const player of [0, 1] as const) {
              const carried = carriedRiverPromises(record, history, key('2d'), player)
              hands[player].combos.forEach((held, h) => {
                expect(carried.reach[index(held)]).toBeCloseTo(reach[player][h] as number, 12)
              })
            }
            return
          }
          const strategy = solution.strategy.get(node.history) as Float64Array
          node.children.forEach((child, action) => {
            const next = Float64Array.from(
              reach[node.player],
              (r, h) => r * (strategy[h * node.actions.length + action] as number),
            )
            check(
              child,
              `${history}${node.actions[action] as string}`,
              node.player === 0 ? [next, reach[1]] : [reach[0], next],
            )
          })
        }
        const initial = [hands[0].weights, hands[1].weights] as [Float64Array, Float64Array]
        if (gadgetPlayer !== undefined) initial[gadgetPlayer] = solution.followShare as Float64Array
        check(solution.tree, '', initial)
        const leaf = record.leaves.get('kk')
        if (leaf === undefined) throw new Error('expected recorded leaf')
        const before = leaf.weight.slice()
        riverValues(solution)
        expect(leaf.weight).toEqual(before)
      },
    )

    it('converts the old-origin 50 into next-root 80 chips, with compatible mass two', () => {
      const base = spotOf()
      const spot: RiverSpot = { ...base, ranges: [[combo('Ac Qc', 2)], [combo('As Qd', 3)]] }
      const hands = handsOf(spot)
      const record = createRiverPromiseRecord()
      const hook = perRiverShowdown(spot, half, record)
      for (const player of [0, 1] as const) {
        hook(
          { kind: 'showdown', paid: [30, 30] },
          player,
          hands,
          hands[player].weights,
          hands[player === 0 ? 1 : 0].weights,
          new Float64Array(1),
          { history: 'b30c', weight: 1 },
        )
      }
      const carried = carriedRiverPromises(record, 'b30c', key('2d'), 0)
      const o = index(hands[1].combos[0] as RangeCombo)
      expect(carried.masses[o]).toBe(2)
      expect(carried.cfvs[o]).toBe(100)
      expect((carried.promises[o] as number) * 160).toBe(80)
      expect((carried.promises[o] as number) * 160).not.toBe(50)
    })

    it('removes blocked weighted holdings and marks zero mass, while keeping zero-reach CFVs', () => {
      const base = spotOf()
      const spot: RiverSpot = {
        ...base,
        ranges: [
          base.ranges[0].slice(0, 2),
          [...base.ranges[1], combo('8h 9h'), combo('2c 2d', 0)],
        ],
      }
      const hands = handsOf(spot)
      const reaches = [hands[0].weights, Float64Array.of(3, 1, 0, 1)] as const
      const record = createRiverPromiseRecord()
      const hook = perRiverShowdown(spot, half, record)
      for (const player of [0, 1] as const) {
        hook(
          { kind: 'showdown', paid: [30, 30] },
          player,
          hands,
          reaches[player],
          reaches[player === 0 ? 1 : 0],
          new Float64Array(hands[player].combos.length),
          { history: 'b30c', weight: 1 },
        )
      }
      const carried = carriedRiverPromises(record, 'b30c', key('Qc'), 0)
      expect(carried.reach[index(combo('Ac Qc'))]).toBe(0)
      expect(carried.reach[index(combo('8h 8d'))]).toBe(0.5)
      for (const text of ['Kc Qc', '8h 9h', '2c 2d']) {
        expect(carried.zeroMass[index(combo(text))]).toBe(1)
        expect(carried.promises[index(combo(text))]).toBeNaN()
      }
      for (const text of ['As Qd', '6h 5h']) {
        const o = index(combo(text))
        expect(carried.masses[o]).toBe(0.5)
        expect(carried.zeroMass[o]).toBe(0)
        expect(carried.promises[o]).toBe(0.5)
      }
      expect(() => carriedRiverPromises(record, 'missing', key('Qc'), 0)).toThrow()
      expect(() => carriedRiverPromises(record, 'b30c', key('Ah'), 0)).toThrow()
    })

    it('keeps all-ins exact and out of the carried record', () => {
      const spot = spotOf()
      const hands = handsOf(spot)
      const record = createRiverPromiseRecord()
      const hook = perRiverShowdown(
        spot,
        () => {
          throw new Error('all-in queried network')
        },
        record,
      )
      const exact = allInShowdown(turnRivers(spot.board), hands)
      for (const player of [0, 1] as const) {
        const other = player === 0 ? 1 : 0
        const out = new Float64Array(hands[player].combos.length)
        const expected = new Float64Array(out.length)
        hook(
          { kind: 'showdown', paid: [300, 300] },
          player,
          hands,
          hands[player].weights,
          hands[other].weights,
          out,
          { history: 'ac', weight: 1 },
        )
        exact(player, hands[other].weights, 700, 300, expected)
        expect([...out]).toEqual([...expected])
      }
      expect(record.leaves.size).toBe(0)
    })
    it('values a branch its own range never reaches as if the whole range were there', () => {
      const spot = spotOf()
      const hands = handsOf(spot)
      // Wins in proportion to how much of its own range the evaluator was shown.
      const shown: RiverLeafEvaluator = (river) => {
        const seen = river.ranges[0].reduce((sum, held) => sum + held.weight, 0)
        return [new Float64Array(COMBOS).fill(seen / 10), new Float64Array(COMBOS)]
      }
      const run = (self: Float64Array) => {
        const out = new Float64Array(hands[0].combos.length)
        perRiverShowdown(spot, shown)(
          { kind: 'showdown', paid: [30, 30] },
          0,
          hands,
          self,
          hands[1].weights,
          out,
        )
        return [...out]
      }
      const unreached = run(new Float64Array(hands[0].combos.length))
      expect(unreached).toEqual(run(hands[0].weights))
    })
  })
})
