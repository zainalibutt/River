import { type Card, cardKey, handScore, makeDeck, parseCard } from '@river/engine'
import { afterEach, expect, it, vi } from 'vitest'
import * as solver from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'
import { explicitTurnSolveLeaf } from './bot-turn-explicit-leaf.js'
import { perRiverShowdown } from './bot-turn-river-leaves.js'
import { type RiverValueNetwork, rangeWeights, riverHoldingValues } from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): solver.RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const index = (held: solver.RangeCombo) =>
  comboIndex52(...(held.hole.map(cardKey) as [number, number]))
const baseline: RiverValueNetwork = {
  buckets: 8,
  layers: [
    {
      rows: 16,
      columns: 25,
      slope: null,
      weight: Float32Array.from({ length: 400 }, (_, i) => (i % 25 < 8 ? (i % 25) / 40 : 0)),
      bias: new Float32Array(16).fill(0.25),
    },
  ],
}
const river: RiverValueNetwork = {
  buckets: 1,
  layers: [
    {
      rows: 2,
      columns: 4,
      slope: null,
      weight: new Float32Array(8),
      bias: Float32Array.of(0.4, 0.6),
    },
  ],
}
const options = {
  iterations: 2,
  betSizes: [0.66],
  maxRaises: 1,
  allIn: true,
  scheme: 'dcfr' as const,
}
const spot: solver.RiverSpot = {
  board: cards('Ah Kd 7s 4c'),
  pot: 137,
  stack: 523,
  ranges: [
    [combo('Qc Jc', 2), combo('8s 8h'), combo('5d 6d', 3), combo('As 2s')],
    [combo('Kc Qh', 3), combo('Qc 9c', 2), combo('7c 7d'), combo('8c 9c')],
  ],
  ...options,
}
const ranks = expectedStrengthRanks(turnRivers(spot.board))
afterEach(() => vi.restoreAllMocks())

it('matches independent all-in river enumeration in pot shares for weighted, overlapping, unsorted holdings', () => {
  const leaf = explicitTurnSolveLeaf(baseline, river, options)
  const ranges = rangeWeights(spot)
  // A board-blocked holding must never enter the turn solve or its output.
  ranges[0][index(combo('Ah Qh'))] = 5
  const result = leaf.batch?.([{ board: spot.board, ranks }], ranges, 0, spot.pot, {
    solve: {},
    node: {},
  })?.[0]
  for (const p of [0, 1] as const) {
    const present = new Set(spot.ranges[p].map(index))
    for (const held of spot.ranges[p]) {
      let won = 0,
        mass = 0
      for (const other of spot.ranges[p === 0 ? 1 : 0]) {
        const used = [...spot.board, ...held.hole, ...other.hole].map(cardKey)
        if (new Set(used).size !== used.length) continue
        for (const card of makeDeck()) {
          if (used.includes(cardKey(card))) continue
          const a = handScore([...spot.board, card, ...held.hole])
          const b = handScore([...spot.board, card, ...other.hole])
          won += other.weight * (a > b ? 1 : a === b ? 0.5 : 0)
          mass += other.weight
        }
      }
      expect(result?.[p][index(held)]).toBeCloseTo(won / mass, 6)
    }
    for (let h = 0; h < COMBOS; h++) if (!present.has(h)) expect(result?.[p][h]).toBe(0)
  }
})

it('uses the configured production turn tree, iterations, DCFR and per-river leaves', () => {
  const solve = vi.spyOn(solver, 'solveRiver')
  const leaf = explicitTurnSolveLeaf(baseline, river, options)
  const actual = leaf(spot, ranks)
  expect(solve.mock.calls[0]?.[0]).toMatchObject({ betSizes: [0.66], maxRaises: 1, allIn: true })
  expect(solve.mock.calls[0]?.[1]).toBe(2)
  expect(solve.mock.calls[0]?.[6]).toMatchObject({ scheme: 'dcfr' })
  const direct = solver.riverValues(
    solver.solveRiver(
      spot,
      2,
      undefined,
      perRiverShowdown(spot, river),
      undefined,
      undefined,
      options,
    ),
  )
  for (const p of [0, 1] as const)
    direct.hands[p].combos.forEach((held, h) => {
      expect(actual[p][index(held)]).toBeCloseTo((direct.values[p][h] as number) / spot.pot, 12)
    })
})

it.each(['never', 2] as const)(
  'freezes only the correction, shares players, isolates solve/node, and retains final reads (%s)',
  (refreshIterations) => {
    const solve = vi.spyOn(solver, 'solveRiver')
    const leaf = explicitTurnSolveLeaf(baseline, river, {
      ...options,
      refreshIterations,
      betSizes: [],
      allIn: false,
    })
    const boards = [spot, { ...spot, board: cards('Ah Kd 7s 3c') }].map((s) => ({
      board: s.board,
      ranks: expectedStrengthRanks(turnRivers(s.board)),
    }))
    const ranges = rangeWeights(spot)
    const next = rangeWeights({
      ...spot,
      ranges: [[spot.ranges[0][0] as solver.RangeCombo], spot.ranges[1]],
    })
    const scope = {},
      terminal = {}
    const call = (
      iteration: number | undefined,
      weights = ranges,
      solve = scope,
      node = terminal,
      player: 0 | 1 = 0,
    ) => leaf.batch?.(boards, weights, spot.stack, spot.pot, { solve, node, iteration, player })
    const first = call(1)
    expect(solve).toHaveBeenCalledTimes(2)
    const second = call(2, next, scope, terminal, 1)
    for (const [i, board] of boards.entries()) {
      const before = riverHoldingValues(baseline, spot, board.ranks)
      const after = riverHoldingValues(
        baseline,
        { ...spot, ranges: [[spot.ranges[0][0] as solver.RangeCombo], spot.ranges[1]] },
        board.ranks,
      )
      for (const p of [0, 1] as const)
        for (let h = 0; h < COMBOS; h++)
          expect(second?.[i]?.[p][h]).toBeCloseTo(
            (first?.[i]?.[p][h] as number) + (after[p][h] as number) - (before[p][h] as number),
            10,
          )
    }
    call(undefined, next)
    expect(solve).toHaveBeenCalledTimes(2)
    call(3, next)
    expect(solve).toHaveBeenCalledTimes(refreshIterations === 'never' ? 2 : 4)
    const count = solve.mock.calls.length
    call(1, ranges, {})
    call(1, ranges, scope, {})
    expect(solve).toHaveBeenCalledTimes(count + 4)
    expect(first).not.toEqual(second)
  },
)

it.each([0, -1, 1.5, Number.NaN])('rejects invalid refresh %s', (refreshIterations) => {
  expect(() => explicitTurnSolveLeaf(baseline, river, { ...options, refreshIterations })).toThrow(
    'refreshIterations',
  )
})
