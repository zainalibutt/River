import { type Card, cardKey, handScore, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  boundedRiverAdaptation,
  RIVER_ADAPTATION_ALLOWANCE,
  realizationMixture,
} from './bot-river-adaptation.js'
import { RIVER_POLICY_TUNING, readBasedRiverProposal } from './bot-river-policy.js'
import {
  type Player,
  type RangeCombo,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  riverBestResponseValues,
  riverStrategyValue,
  riverTree,
} from './bot-river-solver.js'

const cards = (s: string) => s.split(' ').map(parseCard)
const held = (s: string, weight = 1): RangeCombo => ({ hole: cards(s) as [Card, Card], weight })
const spot: RiverSpot = {
  board: cards('Ah Kd 7s 4c 2h'),
  pot: 100,
  stack: 200,
  ranges: [
    [held('8s 8h', 0.3), held('5c 6d', 1.7)],
    [held('7c 7d', 0.8), held('8s 6c', 2), held('Qh Qc', 0.1)],
  ],
  betSizes: [0.5],
  allIn: false,
  maxRaises: 0,
}
function policy(
  s: RiverSpot,
  row: (node: Extract<RiverNode, { kind: 'action' }>, h: number) => number[],
): RiverSolution {
  const tree = riverTree(s)
  const strategy = new Map<string, Float64Array>()
  const walk = (node: RiverNode) => {
    if (node.kind !== 'action') return
    strategy.set(
      node.history,
      Float64Array.from(s.ranges[node.player].flatMap((_, h) => row(node, h))),
    )
    node.children.forEach(walk)
  }
  walk(tree)
  return { tree, strategy, spot: s }
}

// Independent explicit deal enumeration: sum hidden opponent holdings BEFORE
// maximizing at a responder information set. No solver values/terminal/masses.
function enumerate(solution: RiverSolution, p: Player): number[] {
  const s = solution.spot
  const other = p === 0 ? 1 : 0
  return s.ranges[p].map((h) => {
    const reach = s.ranges[other].map((o) =>
      h.hole.some((c) => o.hole.some((d) => cardKey(c) === cardKey(d))) ? 0 : o.weight,
    )
    const walk = (node: RiverNode, r: number[]): number => {
      if (node.kind !== 'action')
        return r.reduce((sum, w, j) => {
          const o = s.ranges[other][j] as RangeCombo
          const total = s.pot + node.paid[0] + node.paid[1]
          const diff = handScore([...h.hole, ...s.board]) - handScore([...o.hole, ...s.board])
          const share =
            node.kind === 'fold' ? Number(node.folder !== p) : diff > 0 ? 1 : diff < 0 ? 0 : 0.5
          return sum + w * (share * total - node.paid[p])
        }, 0)
      const values = node.children.map((child, a) =>
        walk(
          child,
          node.player === p
            ? r
            : r.map(
                (w, j) =>
                  w *
                  (solution.strategy.get(node.history)?.[j * node.actions.length + a] as number),
              ),
        ),
      )
      return node.player === p ? Math.max(...values) : values.reduce((sum, v) => sum + v, 0)
    }
    return walk(solution.tree, reach) / reach.reduce((sum, w) => sum + w, 0)
  })
}

describe('inherited river adaptation', () => {
  it.each([0, 1] as const)(
    'matches per-holding enumerated BR for player %i, not self-play',
    (p) => {
      const baseline = policy(spot, (node, h) =>
        node.player === p ? [1, 0] : h === 0 ? [0.2, 0.8] : [0.7, 0.3],
      )
      const actual = riverBestResponseValues(baseline, p)
      enumerate(baseline, p).forEach((v, h) => {
        expect(actual.values[h]).toBeCloseTo(v, 9)
      })
      // Changing the protected holding's placeholder weights must change nothing.
      const ranges = [...spot.ranges] as [RiverSpot['ranges'][0], RiverSpot['ranges'][1]]
      ranges[p] = ranges[p].map((h, i) => ({ ...h, weight: 1000 + i }))
      expect(riverBestResponseValues({ ...baseline, spot: { ...spot, ranges } }, p).values).toEqual(
        actual.values,
      )
      const uniform = {
        ...baseline,
        spot: {
          ...spot,
          ranges: spot.ranges.map((r) =>
            r.map((h) => ({ ...h, weight: 1 })),
          ) as unknown as RiverSpot['ranges'],
        },
      }
      expect(Array.from(riverBestResponseValues(uniform, p).values)).not.toEqual(
        Array.from(actual.values),
      )
    },
  )

  it('conditions mixed realization on own earlier actions and preserves unreachable baseline rows', () => {
    const base = policy(spot, (n) => (n.history === '' ? [0.9, 0.1] : [0.2, 0.8]))
    const proposed = policy(spot, (n) => (n.history === '' ? [0.1, 0.9] : [0.8, 0.2]))
    const mixed = realizationMixture(base, proposed, 0, 0.5)
    expect(mixed.strategy.get('')?.[0]).toBeCloseTo(0.5, 12)
    expect(mixed.strategy.get('kb50')?.[0]).toBeCloseTo(0.26, 12)
    expect(mixed.strategy.get('b50')).toBe(base.strategy.get('b50'))
    const zero = policy(spot, (n) => (n.history === '' ? [0, 1] : [0.2, 0.8]))
    expect(realizationMixture(zero, zero, 0, 0.5).strategy.get('kb50')).toEqual(
      zero.strategy.get('kb50'),
    )
    expect(realizationMixture(base, proposed, 0, 0)).toBe(base)
  })

  it('uses player 1 realization through a bet and a later response to a raise', () => {
    const raisedSpot = { ...spot, maxRaises: 1 }
    const row = (node: Extract<RiverNode, { kind: 'action' }>, proposed: boolean) => {
      if (node.history === 'k') return proposed ? [0.1, 0.9] : [0.9, 0.1]
      if (node.history === 'kb50b150') return proposed ? [0.8, 0.2] : [0.2, 0.8]
      return node.actions.map(() => 1 / node.actions.length)
    }
    const base = policy(raisedSpot, (node) => row(node, false))
    const proposed = policy(raisedSpot, (node) => row(node, true))
    const mixed = realizationMixture(base, proposed, 1, 0.5)
    expect(mixed.strategy.get('kb50b150')?.[0]).toBeCloseTo(0.74, 12)
    expect(mixed.strategy.get('')).toBe(base.strategy.get(''))
  })

  const tiny = { ...spot, ranges: [[held('5c 6d')], [held('7c 7d')]] as const }
  const base = policy(tiny, () => [1, 0])
  const proposal = policy(tiny, (n) => (n.history === '' ? [0, 1] : [1, 0]))
  const objective = (s: RiverSolution) => riverStrategyValue(s, 0)
  it('picks zero for a cap-breaking proposal, positive for a safe one, and the maximal interior weight', () => {
    const run = (promise: number) =>
      boundedRiverAdaptation(base, { player: 1, promises: Float64Array.of(promise) }, () => ({
        solution: proposal,
        value: objective,
      }))
    expect(enumerate(base, 1)).toEqual([100])
    expect(enumerate(proposal, 1)).toEqual([150])
    expect(run(100).weight).toBe(0)
    expect(run(150).weight).toBe(1)
    const middle = run(125)
    expect(middle.weight).toBeCloseTo(0.5, 5)
    expect(enumerate(middle.solution, 1)[0]).toBeLessThanOrEqual(125 + RIVER_ADAPTATION_ALLOWANCE)
    expect(run(150).solution.strategy.get('b50')).toBe(base.strategy.get('b50'))
    const worse = boundedRiverAdaptation(
      base,
      { player: 1, promises: Float64Array.of(150) },
      () => ({ solution: proposal, value: (s) => -objective(s) }),
    )
    expect(worse.weight).toBe(0)
  })

  it('records baseline violations and returns the exact root without querying a model or changing promises', () => {
    const promises = Float64Array.of(99)
    const result = boundedRiverAdaptation(base, { player: 1, promises }, () => {
      throw new Error('baseline gate skipped')
    })
    expect(result.solution).toBe(base)
    expect(result.weight).toBe(0)
    expect(result.baseline.violations).toBe(1)
    expect(result.baseline.maxViolation).toBe(1)
    expect(promises).toEqual(Float64Array.of(99))
  })

  it('keeps the posterior/model objective separate from protected support placeholders', () => {
    const reads = {
      bet: 0.4,
      fold: 0.8,
      raise: 0.1,
      foldSmall: 0.8,
      foldMedium: 0.8,
      foldLarge: 0.8,
      air: 0.3,
      size: 0.5,
      trust: 0.7,
    }
    const baseline = policy(spot, () => [0.5, 0.5])
    const posterior = [held('7c 7d', 0.1), held('Qh Qc', 0.9)]
    const tuning = { ...RIVER_POLICY_TUNING, iterations: 40 }
    const a = readBasedRiverProposal(baseline, posterior, reads, 1, tuning)
    const changed = {
      ...baseline,
      spot: {
        ...spot,
        ranges: [spot.ranges[0], spot.ranges[1].map((h) => ({ ...h, weight: 1000 }))] as const,
      },
    }
    const b = readBasedRiverProposal(changed, posterior, reads, 1, tuning)
    expect(a).not.toBeNull()
    expect(b?.solution.strategy).toEqual(a?.solution.strategy)
    expect(b?.value(baseline)).toBe(a?.value(baseline))
  })
})
