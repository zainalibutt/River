import { createHash } from 'node:crypto'
import { type Card, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  addRiverAction,
  type CfrOptions,
  type CfrState,
  type RangeCombo,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  riverValues,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string): RangeCombo => ({ hole: cards(text) as [Card, Card], weight: 1 })
// Same polarised game as bot-river-solver.test.ts, with production flop sizing.
const spot: RiverSpot = {
  board: cards('Ah Kd 7s 4c 2h'),
  pot: 100,
  stack: 1000,
  ranges: [[combo('8s 8h')], [combo('7c 7d'), combo('7h 7d'), combo('5c 6d'), combo('5d 6c')]],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 1,
}
const bytes = (solution: RiverSolution & { readonly followShare?: Float64Array }) => {
  const hash = createHash('sha256')
  for (const [history, table] of solution.strategy) {
    hash.update(history).update(Buffer.from(table.buffer, table.byteOffset, table.byteLength))
  }
  if (solution.followShare) hash.update(Buffer.from(solution.followShare.buffer))
  return hash.digest('hex')
}

function stateOf(solution: RiverSolution): CfrState {
  if (!solution.cfrState) throw new Error('missing captured state')
  return solution.cfrState
}

function solve(iterations: number, options: CfrOptions, tree?: RiverNode, target = spot) {
  return solveRiver(target, iterations, undefined, undefined, undefined, tree, {
    scheme: 'dcfr',
    captureState: true,
    ...options,
  })
}

describe.each(['cfr+', 'dcfr'] as const)('%s warm starts', (scheme) => {
  it.each([undefined, 0, 1] as const)(
    'exactly resumes an unchanged tree with gadget %s',
    (player) => {
      const gadget =
        player === undefined
          ? undefined
          : {
              player,
              promises: new Float64Array(spot.ranges[player].length).fill(40),
            }
      const options = { scheme, captureState: true, alpha: 1.2, beta: 0.3, gamma: 2.5 }
      const root = solveRiver(spot, 17, undefined, undefined, gadget, undefined, options)
      const before = structuredClone(stateOf(root))
      const resumed = solveRiver(spot, 23, undefined, undefined, gadget, root.tree, {
        ...options,
        warmStart: stateOf(root),
      })
      const uninterrupted = solveRiver(spot, 40, undefined, undefined, gadget, undefined, options)
      expect(bytes(resumed)).toBe(bytes(uninterrupted))
      expect(stateOf(resumed)).toEqual(stateOf(uninterrupted))
      expect(stateOf(root)).toEqual(before)
    },
  )
})

it('matches histories, combos and action labels despite reordered tables; new entries are zero', () => {
  const root = solve(40, {})
  const source = stateOf(root)
  const before = structuredClone(source)
  const reorder = (node: RiverNode): RiverNode =>
    node.kind !== 'action'
      ? node
      : {
          ...node,
          actions: [...node.actions].reverse(),
          children: [...node.children].reverse().map(reorder),
        }
  const tree = reorder(addRiverAction(spot, root.tree, 'k', 50))
  const target: RiverSpot = {
    ...spot,
    ranges: [
      [combo('Qc Qh'), ...spot.ranges[0]],
      [...spot.ranges[1]]
        .reverse()
        .map((entry) => ({ ...entry, hole: [...entry.hole].reverse() as [Card, Card] })),
    ],
  }
  const result = stateOf(solve(0, { warmStart: source }, tree, target))
  let shared = 0
  let newActions = 0
  let newInfos = 0
  let newCombos = 0
  for (const [history, info] of result.infos) {
    const previous = source.infos.get(history)
    if (!previous) newInfos++
    for (const [pair, h] of result.holdings[info.player]) {
      const old = source.holdings[info.player].get(pair)
      if (old === undefined) newCombos++
      info.actions.forEach((label, a) => {
        const oldAction = previous?.actions.indexOf(label) ?? -1
        const at = h * info.actions.length + a
        if (previous && old !== undefined && oldAction >= 0) {
          const oldAt = old * previous.actions.length + oldAction
          expect(info.regret[at]).toBe(previous.regret[oldAt])
          expect(info.sum[at]).toBe(previous.sum[oldAt])
          shared++
        } else {
          expect(info.regret[at]).toBe(0)
          expect(info.sum[at]).toBe(0)
          if (previous && oldAction < 0) newActions++
        }
      })
    }
  }
  expect(shared).toBeGreaterThan(0)
  expect(newActions).toBeGreaterThan(0)
  expect(newInfos).toBeGreaterThan(0)
  expect(newCombos).toBeGreaterThan(0)
  expect(source).toEqual(before)
})

it('retains authoritative played locks and continues the discount clock at iteration 41', () => {
  const root = solve(40, {})
  const source = stateOf(root)
  const fixed = root.strategy.get('') as Float64Array
  const visits: {
    iteration: number | undefined
    local: number | undefined
    discount: number | undefined
  }[] = []
  const showdown: ShowdownValues = (_node, _player, _hands, _self, _opponent, out, visit) => {
    out.fill(0)
    if (visit)
      visits.push({
        iteration: visit.iteration,
        local: visit.localIteration,
        discount: visit.discount,
      })
  }
  const tree = addRiverAction(spot, root.tree, 'k', 50)
  const result = solveRiver(spot, 1, undefined, showdown, undefined, tree, {
    scheme: 'dcfr',
    captureState: true,
    warmStart: source,
    fixedStrategies: new Map([['', fixed]]),
  })
  expect(result.strategy.get('')).toEqual(fixed)
  expect(stateOf(result).infos.get('')?.regret).toEqual(source.infos.get('')?.regret)
  expect(visits.length).toBeGreaterThan(0)
  expect(
    visits.every(
      (visit) => visit.iteration === 41 && visit.local === 1 && visit.discount === (41 / 42) ** 2,
    ),
  ).toBe(true)
})

it('starts an introduced gadget from zero with its own denominator at the continued clock', () => {
  const root = solve(40, {})
  const result = solveRiver(
    spot,
    1,
    undefined,
    undefined,
    {
      player: 1,
      promises: riverValues(root).values[1],
    },
    addRiverAction(spot, root.tree, 'k', 50),
    {
      scheme: 'dcfr',
      captureState: true,
      warmStart: stateOf(root),
    },
  )
  expect([...(result.followShare ?? [])]).toEqual([0.5, 0.5, 0.5, 0.5])
  expect(stateOf(result).gadget?.averageWeight).toBe((41 / 42) ** 2)
})

it('rejects incompatible discount schedules', () => {
  const root = solve(40, {})
  expect(() => solve(1, { warmStart: stateOf(root), gamma: 1 })).toThrow('same CFR discounts')
})

it('resets a changed gadget instead of mixing its prior follow samples', () => {
  const options = { scheme: 'dcfr', captureState: true } as const
  const root = solveRiver(
    spot,
    40,
    undefined,
    undefined,
    {
      player: 1,
      promises: new Float64Array(4).fill(40),
    },
    undefined,
    options,
  )
  const result = solveRiver(
    spot,
    1,
    undefined,
    undefined,
    {
      player: 1,
      promises: new Float64Array(4).fill(41),
    },
    root.tree,
    { ...options, warmStart: stateOf(root) },
  )
  expect([...(result.followShare ?? [])]).toEqual([0.5, 0.5, 0.5, 0.5])
  expect(stateOf(result).gadget?.averageWeight).toBe((41 / 42) ** 2)
})

it('keeps the unset off-tree solve byte-identical to the pre-warm-start solver', () => {
  const root = solveRiver(spot, 40, undefined, undefined, undefined, undefined, { scheme: 'dcfr' })
  const widened = addRiverAction(spot, root.tree, 'k', 50)
  const result = solveRiver(
    spot,
    40,
    undefined,
    undefined,
    { player: 1, promises: riverValues(root).values[1] },
    widened,
    { scheme: 'dcfr', fixedStrategies: new Map([['', root.strategy.get('') as Float64Array]]) },
  )
  expect(bytes(result)).toBe('cf1fd6f758504b4e5500e0c31bc94bdca7170e0baf763429737994ea41c42b71')
})
