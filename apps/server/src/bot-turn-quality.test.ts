import { readFileSync } from 'node:fs'
import { type Card, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  compatibleMasses,
  prepare,
  type RangeCombo,
  type RiverSpot,
  riverReport,
  type ShowdownValues,
  solveRiver,
  terminal,
} from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { turnEndValues, turnRivers } from './bot-turn-end-data.js'
import {
  actionValues,
  decisionLoss,
  riverAveragedShowdown,
  valuesBelow,
} from './bot-turn-quality.js'
import {
  riverHoldingValues,
  type ValueNetworkDescription,
  valueNetworkFrom,
} from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
// A small network with random weights stands in for the river network: these
// tests check the arithmetic, not how well the network values a river.
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))

describe('the offline decision check', () => {
  const spot: RiverSpot = {
    board: cards('Qs 9h 6d 3c 2s'),
    pot: 100,
    stack: 300,
    ranges: [
      [combo('As Ks'), combo('9c 9d', 2), combo('7h 8h'), combo('Qc Jc'), combo('4h 5h')],
      [combo('Qd Td'), combo('6h 6c'), combo('Ah 5c', 2), combo('4c 5c'), combo('Kd Kc')],
    ],
    betSizes: [0.5, 1],
    allIn: true,
    maxRaises: 2,
  }
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const plain: ShowdownValues = (node, traverser, held, _self, opponent, out) => {
    out.set(terminal(node, traverser, held, opponent, spot.pot))
  }

  it("values a solution as the solver's own report does", () => {
    const solution = solveRiver(spot, 60)
    const report = riverReport(solution)
    const met = compatibleMasses(hands[0], hands[1], hands[1].weights)
    const deals = hands[0].weights.reduce((sum, weight, h) => sum + weight * (met[h] as number), 0)
    for (const traverser of [0, 1] as const) {
      const other = traverser === 0 ? 1 : 0
      const values = valuesBelow(
        solution,
        hands,
        plain,
        solution.tree,
        traverser,
        hands[traverser].weights,
        hands[other].weights,
      )
      const total = hands[traverser].weights.reduce(
        (sum, weight, h) => sum + weight * (values[h] as number),
        0,
      )
      expect(total / deals).toBeCloseTo(report.value[traverser], 6)
    }
  })

  it('finds almost nothing given up by a converged solution, and plenty by an even mix', () => {
    const solution = solveRiver(spot, 400)
    for (const history of ['', 'k']) {
      const at = actionValues(solution, hands, plain, history)
      if (at === undefined) throw new Error(`no decision at "${history}"`)
      const width = at.values.length
      const own = decisionLoss(at, solution.strategy.get(history) as Float64Array)
      const even = decisionLoss(
        at,
        new Float64Array(hands[at.player].combos.length * width).fill(1 / width),
      )
      expect(own).toBeGreaterThanOrEqual(0)
      expect(own).toBeLessThan(0.01)
      expect(even).toBeGreaterThan(own + 0.02)
    }
  })

  it('values closed turn betting as the turn-end answers are made', () => {
    const turn: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
      pot: 100,
      stack: 300,
      ranges: [
        [combo('Ac Qc', 1), combo('7c 7d', 2), combo('Qs Js', 1), combo('5c 6c', 3)],
        [combo('As Qd', 2), combo('Kc Qc', 1), combo('8h 8d', 1), combo('6h 5h', 2)],
      ],
      betSizes: [0.66],
      allIn: true,
      maxRaises: 1,
    }
    const held = [prepare(turn.ranges[0], turn.board), prepare(turn.ranges[1], turn.board)] as const
    const showdown = riverAveragedShowdown(turn, network)
    const answers = turnEndValues(turn, turnRivers(turn.board), (riverSpot, ranks) =>
      riverHoldingValues(network, riverSpot, ranks),
    )
    const node = { kind: 'showdown', paid: [0, 0] } as const
    for (const traverser of [0, 1] as const) {
      const other = traverser === 0 ? 1 : 0
      const out = new Float64Array(held[traverser].combos.length)
      showdown(node, traverser, held, held[traverser].weights, held[other].weights, out)
      const met = compatibleMasses(held[traverser], held[other], held[other].weights)
      out.forEach((value, h) => {
        const index = comboIndex52(
          held[traverser].cards[2 * h] as number,
          held[traverser].cards[2 * h + 1] as number,
        )
        const expected = (met[h] as number) * (answers[traverser][index] as number) * turn.pot
        expect(value).toBeCloseTo(expected, 4)
      })
    }
  })
})
