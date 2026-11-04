import { existsSync, readFileSync } from 'node:fs'
import { type Card, handScore, makeDeck, mulberry32 } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  bestResponseCertificate,
  comboBestResponseValues,
  validateStrategy,
} from './bot-preflop-solve-br.js'
import { type DealModel, type PreflopStrategy, PreflopTrainer } from './bot-preflop-solve-cfr.js'
import {
  classDealCounts,
  compatible,
  type EquityTable,
  HAND_CLASSES,
  type HandClass,
  loadOrGenerateEquity,
  matchupKey,
  sampleEquity,
  scoreSeven,
  validateEquityTable,
} from './bot-preflop-solve-equity.js'
import { type makePack, reachedFrequencies } from './bot-preflop-solve-output.js'
import { DEFAULT_HAND_REALISATION, isHandRealisation } from './bot-preflop-solve-realisation.js'
import {
  DEFAULT_REALISATION,
  decisionNodes,
  type PreflopNode,
  preflopTree,
  type Realisation,
  type Seat,
  terminalUtility,
} from './bot-preflop-solve-tree.js'
import { hasPreflopPack, preflopPackFile } from './bot-preflop-tables.js'

/** Six-card toy deck Js Jh Qs Qh Ks Kh; three possible pair holdings, deterministic showdown. */
const toy: DealModel = {
  classes: ['JJ', 'QQ', 'KK'],
  multiplicities: [1, 1, 1],
  deals: [0, 1, 1, 1, 0, 1, 1, 1, 0],
  equity: [0.5, 0, 0, 1, 0.5, 0, 1, 1, 0.5],
}
function uniform(tree: PreflopNode, n: number): PreflopStrategy {
  return new Map(
    decisionNodes(tree).map((node) => [
      node.id,
      new Float64Array(n * node.actions.length).fill(1 / node.actions.length),
    ]),
  )
}
/**
 * Independent normal-form oracle: enumerate ALL pure plans, including unreachable infosets.
 * No CF reach, vector recursion, trainer payoff or production BR code is shared.
 * The 1.5 bb toy has 216 BTN plans and 64 BB plans across all three private holdings.
 */
function exhaustive(
  tree: PreflopNode,
  strategy: PreflopStrategy,
  player: Seat,
  factors: Realisation,
): {
  value: number
  br: number
  plans: number
} {
  const ownInfos = decisionNodes(tree)
    .filter((node) => node.player === player)
    .flatMap((node) =>
      toy.classes.map((_, h) => ({ key: `${node.id}:${h}`, width: node.actions.length })),
    )
  const plan = new Map<string, number>()
  const value = (pure: boolean): number => {
    let total = 0
    for (let first = 0; first < 3; first += 1) {
      for (let second = 0; second < 3; second += 1) {
        if (first === second) continue
        const walk = (node: PreflopNode, opposing = [1, 1, 1]): number => {
          if (node.kind !== 'decision') {
            if (node.kind === 'fold')
              return node.folder === player ? -node.paid[player] : (node.paid[1 - player] as number)
            const win = player === 0 ? Number(first > second) : Number(second > first)
            const pot = node.paid[0] + node.paid[1]
            if (node.kind === 'all-in') return pot * win - node.paid[player]
            if (!isHandRealisation(factors))
              return pot * win * (player === 0 ? factors.ip : factors.oop) - node.paid[player]
            // Independent scalar oracle for this toy's only flop: checked limp, depth 1.5.
            // Enumerate all possible opposing holdings, excluding our two cards.
            const hero = player === 0 ? first : second
            let mass = 0
            let winningMass = 0
            for (let other = 0; other < 3; other += 1) {
              if (other === hero) continue
              mass += opposing[other] as number
              winningMass += (opposing[other] as number) * Number(hero > other)
            }
            if (mass === 0) return 0
            const equity = winningMass / mass
            const q =
              Math.max(
                0,
                Math.min(
                  1,
                  (equity - factors.equity.floor) / (factors.equity.ceiling - factors.equity.floor),
                ),
              ) ** factors.equity.power
            const curve = factors.pots.limped[player === 0 ? 'ip' : 'oop']
            const deep =
              curve.base +
              curve.equitySlope * q +
              factors.features.pair +
              factors.features.highCard * ((11 + hero - 2) / 12)
            const spr = (1.5 - node.paid[player]) / pot
            const factor = Math.max(
              factors.bounds.min,
              Math.min(factors.bounds.max, 1 + (spr / (spr + factors.sprHalfLife)) * (deep - 1)),
            )
            return pot * equity * factor - node.paid[player]
          }
          const hand = node.player === 0 ? first : second
          if (pure && node.player === player)
            return walk(
              node.children[plan.get(`${node.id}:${hand}`) as number] as PreflopNode,
              opposing,
            )
          let result = 0
          for (let action = 0; action < node.actions.length; action += 1)
            result +=
              ((strategy.get(node.id) as Float64Array<ArrayBufferLike>)[
                hand * node.actions.length + action
              ] as number) *
              walk(
                node.children[action] as PreflopNode,
                node.player === player
                  ? opposing
                  : opposing.map(
                      (reach, other) =>
                        reach *
                        ((strategy.get(node.id) as Float64Array)[
                          other * node.actions.length + action
                        ] as number),
                    ),
              )
          return result
        }
        total += walk(tree) / 6
      }
    }
    return total
  }
  let br = Number.NEGATIVE_INFINITY
  let plans = 0
  const enumerate = (info: number): void => {
    if (info === ownInfos.length) {
      br = Math.max(br, value(true))
      plans += 1
      return
    }
    const current = ownInfos[info] as { key: string; width: number }
    for (let a = 0; a < current.width; a += 1) {
      plan.set(current.key, a)
      enumerate(info + 1)
    }
  }
  enumerate(0)
  return { value: value(false), br, plans }
}
describe('offline preflop solver: independent exhaustive oracle', () => {
  it('matches the independent range-dependent v2 toy oracle, including blocked/unreachable ranges', () => {
    const tree = preflopTree(1.5)
    const policies = [new Map(uniform(tree, 3)), new Map(uniform(tree, 3))]
    policies[1]?.set('button', Float64Array.from([0, 1, 0, 0, 0, 1, 1, 0, 0]))
    for (const policy of policies) {
      const actual = bestResponseCertificate(tree, toy, policy, DEFAULT_HAND_REALISATION)
      for (const p of [0, 1] as const) {
        const oracle = exhaustive(tree, policy, p, DEFAULT_HAND_REALISATION)
        expect(actual.profileValueBb[p]).toBeCloseTo(oracle.value, 12)
        expect(actual.bestResponseValueBb[p]).toBeCloseTo(oracle.br, 12)
      }
    }
    const trainer = new PreflopTrainer(tree, toy, DEFAULT_HAND_REALISATION)
    trainer.step(2000)
    const policy = trainer.average()
    const a = exhaustive(tree, policy, 0, DEFAULT_HAND_REALISATION)
    const b = exhaustive(tree, policy, 1, DEFAULT_HAND_REALISATION)
    expect((a.br - a.value + b.br - b.value) / 2).toBeLessThan(0.0001)
  })
  it('matches every BR, profile value and general-sum improvement on the six-card toy', () => {
    const tree = preflopTree(1.5)
    const policy = uniform(tree, 3)
    const certificate = bestResponseCertificate(tree, toy, policy, DEFAULT_REALISATION)
    const first = exhaustive(tree, policy, 0, DEFAULT_REALISATION)
    const second = exhaustive(tree, policy, 1, DEFAULT_REALISATION)
    expect([first.plans, second.plans]).toEqual([216, 64])
    expect(certificate.profileValueBb[0]).toBeCloseTo(first.value, 12)
    expect(certificate.profileValueBb[1]).toBeCloseTo(second.value, 12)
    expect(certificate.bestResponseValueBb[0]).toBeCloseTo(first.br, 12)
    expect(certificate.bestResponseValueBb[1]).toBeCloseTo(second.br, 12)
    const gain = first.br - first.value + second.br - second.value
    expect(certificate.nashConvBb).toBeCloseTo(gain, 12)
    expect(certificate.exploitabilityBb).toBeCloseTo(gain / 2, 12)
    expect(certificate.percentOfPostedPot).toBeCloseTo((100 * gain) / 3, 12)
  })
  it.each(['cfr+', 'dcfr'] as const)(
    'solves the toy with %s and passes exhaustive best response',
    (scheme) => {
      const tree = preflopTree(1.5)
      const factors = { ip: 1, oop: 1 }
      const trainer = new PreflopTrainer(tree, toy, factors, scheme)
      trainer.step(2000)
      const policy = trainer.average()
      const first = exhaustive(tree, policy, 0, factors)
      const second = exhaustive(tree, policy, 1, factors)
      expect((first.br - first.value + second.br - second.value) / 2).toBeLessThan(0.0001)
      expect(first.value + second.value).toBeCloseTo(0, 12)
      const actual = bestResponseCertificate(tree, toy, policy, factors)
      expect(actual.bestResponseValueBb[0]).toBeCloseTo(first.br, 12)
      expect(actual.bestResponseValueBb[1]).toBeCloseTo(second.br, 12)
    },
  )
  it('uses actual blocked node ranges, handles unreachable histories and rejects missing policies', () => {
    const tree = preflopTree(1.5)
    const strategy = new Map(uniform(tree, 3))
    // Button limps JJ, jams QQ and folds KK. The asymmetric flop range is general-sum.
    strategy.set('button', Float64Array.from([0, 1, 0, 0, 0, 1, 1, 0, 0]))
    const actual = bestResponseCertificate(tree, toy, strategy, DEFAULT_REALISATION)
    for (const p of [0, 1] as const) {
      const oracle = exhaustive(tree, strategy, p, DEFAULT_REALISATION)
      expect(actual.bestResponseValueBb[p]).toBeCloseTo(oracle.br, 12)
      expect(actual.profileValueBb[p]).toBeCloseTo(oracle.value, 12)
    }
    const first = exhaustive(tree, strategy, 0, DEFAULT_REALISATION)
    const second = exhaustive(tree, strategy, 1, DEFAULT_REALISATION)
    expect(actual.exploitabilityBb).toBeCloseTo(
      (first.br - first.value + second.br - second.value) / 2,
      12,
    )
    expect(Math.abs(actual.exploitabilityBb - (first.br + second.br) / 2)).toBeGreaterThan(0.001)
    expect(() => bestResponseCertificate(tree, toy, new Map(), DEFAULT_REALISATION)).toThrow(
      'missing',
    )
  })
})
describe('offline preflop tree and payoff', () => {
  it('v3 includes relative and observed sizes with only jam raises after a four-bet', () => {
    for (const depth of [100, 200]) {
      const nodes = decisionNodes(preflopTree(depth))
      const raises = (id: string) =>
        nodes
          .find((n) => n.id === id)
          ?.actions.filter((a) => a.kind === 'raise')
          .map((a) => a.to)
      expect(raises('button')).toEqual([2, 2.5, 3])
      expect(raises('button/limp')).toEqual([3, 4])
      expect(raises('button/raise-2')).toEqual([7, 9, 15])
      expect(raises('button/raise-2.5')).toEqual([8.75, 9, 11.25, 15])
      expect(raises('button/raise-3')).toEqual([9, 10.5, 13.5, 15])
      expect(raises('button/raise-2/raise-7')).toEqual([16.1, 18, 24])
      expect(raises('button/raise-2.5/raise-9')).toEqual([18, 20.7, 24])
      // 18/24 collapse to the legal min-raise of 28 after a 15 bb 3-bet.
      expect(raises('button/raise-2/raise-15')).toEqual([28, 34.5])
      for (const node of nodes.filter((n) => n.id.split('/').length >= 4))
        expect(node.actions.every((a) => a.kind !== 'raise')).toBe(true)
      expect(nodes.length).toBeLessThan(110)
    }
  })
  it('has all requested branches and sizes at 100 and 200 bb', () => {
    for (const depth of [100, 200]) {
      const nodes = decisionNodes(preflopTree(depth, 'v2'))
      const labels = (id: string) => nodes.find((n) => n.id === id)?.actions.map((a) => a.label)
      expect(labels('button')).toEqual(['fold', 'limp', 'raise-2.5', 'jam'])
      expect(labels('button/limp')).toEqual(['check', 'raise-4', 'jam'])
      expect(labels('button/limp/raise-4')).toEqual(['fold', 'call', 'jam'])
      expect(labels('button/raise-2.5')).toEqual(['fold', 'call', 'raise-9', 'jam'])
      expect(labels('button/raise-2.5/raise-9')).toEqual(['fold', 'call', 'raise-22', 'jam'])
      expect(labels('button/raise-2.5/raise-9/raise-22')).toEqual(['fold', 'call', 'jam'])
      expect(labels('button/raise-2.5/raise-9/raise-22/jam')).toEqual(['fold', 'call'])
      expect(nodes).toHaveLength(12)
    }
  })
  it('enforces minimum raises, caps and duplicate merging over fractional/short/deep stacks', () => {
    for (const depth of [1, 1.1, 1.5, 1.99, 2, 2.5, 3, 4, 5, 9, 10, 20, 22, 22.5, 40, 100, 200]) {
      const walk = (node: PreflopNode): void => {
        expect(node.paid.every((p) => p >= 0 && p <= depth)).toBe(true)
        if (node.kind !== 'decision') {
          if (node.kind !== 'fold') expect(node.paid[0]).toBe(node.paid[1])
          if (node.kind === 'all-in') expect(node.paid[0]).toBe(depth)
          if (node.kind === 'flop') expect(node.paid[0]).toBeLessThan(depth)
          return
        }
        expect(new Set(node.actions.map((a) => `${a.kind}:${a.to}`)).size).toBe(node.actions.length)
        const other = node.paid[1 - node.player] as number
        const raises = node.actions.filter((a) => a.kind === 'raise' || a.kind === 'jam')
        expect(new Set(raises.map((a) => a.to)).size).toBe(raises.length)
        for (const action of raises) {
          expect(action.to).toBeGreaterThan(other)
          expect(action.to).toBeLessThanOrEqual(depth)
          if (action.to !== depth) expect(action.to).toBeGreaterThanOrEqual(other + node.lastRaise)
          if (action.kind === 'jam') expect(action.to).toBe(depth)
        }
        node.children.forEach(walk)
      }
      walk(preflopTree(depth))
    }
    expect(decisionNodes(preflopTree(2.5))[0]?.actions.map((a) => a.label)).toEqual([
      'fold',
      'limp',
      'raise-2',
      'jam',
    ])
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => preflopTree(bad)).toThrow()
  })
  it('uses full-pot equity, subtracts total contributions and bypasses realisation for all-ins', () => {
    const flop = { kind: 'flop', paid: [9, 9] } as const
    expect(terminalUtility(flop, 0, 0.6, DEFAULT_REALISATION)).toBeCloseTo(18 * 0.6 * 1.05 - 9, 12)
    expect(terminalUtility(flop, 1, 0.4, DEFAULT_REALISATION)).toBeCloseTo(18 * 0.4 * 0.95 - 9, 12)
    const jam = { kind: 'all-in', paid: [100, 100] } as const
    expect(terminalUtility(jam, 0, 0.6, { ip: 9, oop: 0.01 })).toBeCloseTo(20, 12)
    expect(terminalUtility(jam, 1, 0.4, DEFAULT_REALISATION)).toBeCloseTo(-20, 12)
    const fold = { kind: 'fold', folder: 1, paid: [100, 9] } as const
    expect(terminalUtility(fold, 0, 0, DEFAULT_REALISATION)).toBe(9)
    expect(terminalUtility(fold, 1, 1, DEFAULT_REALISATION)).toBe(-9)
  })
})
describe('preflop equity and exact card removal', () => {
  it('partitions all 1326 combos and 1624350 ordered legal deals with exact class weights', () => {
    expect(HAND_CLASSES).toHaveLength(169)
    expect(HAND_CLASSES.reduce((n, h) => n + h.combos.length, 0)).toBe(1326)
    expect(
      new Set(
        HAND_CLASSES.flatMap((h) => h.combos.map((c) => [...c].sort((a, b) => a - b).join(','))),
      ).size,
    ).toBe(1326)
    const counts = classDealCounts(HAND_CLASSES)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1326 * 1225)
    expect(counts[0]).toBe(6) // AA vs AA: six first combos, one disjoint second combo each.
    expect(counts[14]).toBe(36) // AA vs KK.
    for (let a = 0; a < 169; a += 1) {
      expect(counts.slice(a * 169, (a + 1) * 169).reduce((x, y) => x + y, 0)).toBe(
        (HAND_CLASSES[a] as HandClass).combos.length * 1225,
      )
    }
    expect(compatible([12, 25], [12, 11])).toBe(false)
    expect(compatible([12, 25], [11, 24])).toBe(true)
  })
  it('keeps suit orbits correct and matches the engine evaluator on 5000 boards', () => {
    expect(matchupKey([12, 11], [25, 24])).toBe(matchupKey([38, 37], [51, 50]))
    expect(matchupKey([12, 11], [25, 24])).toBe(matchupKey([11, 12], [24, 25]))
    expect(matchupKey([12, 11], [25, 24])).not.toBe(matchupKey([12, 24], [25, 11]))
    const random = mulberry32(0x17aabc)
    const deck = makeDeck()
    const threePairs = new Int32Array([12, 25, 11, 24, 10, 23, 0])
    expect(scoreSeven(threePairs)).toBe(handScore(Array.from(threePairs, (i) => deck[i] as Card)))
    for (let trial = 0; trial < 5000; trial += 1) {
      const ids = new Set<number>()
      while (ids.size < 7) ids.add(Math.floor(random() * 52))
      const cards = Int32Array.from(ids)
      expect(scoreSeven(cards)).toBe(handScore(Array.from(cards, (i) => deck[i] as Card)))
    }
  })
  it('spot-checks AA/KK, AKs/QQ and 72o/AA with deterministic board sampling', () => {
    const cases = [
      { a: [12, 25], b: [11, 24], expected: 0.82 },
      { a: [12, 11], b: [10, 23], expected: 0.46 },
      { a: [5, 13], b: [12, 25], expected: 0.12 },
    ] as const
    for (const [i, spot] of cases.entries()) {
      const result = sampleEquity(spot.a, spot.b, 20000, 781 + i)
      expect(result.equity).toBeGreaterThan(spot.expected - 0.025)
      expect(result.equity).toBeLessThan(spot.expected + 0.025)
      expect(result.variance).toBeGreaterThan(0)
    }
    expect(sampleEquity([12, 25], [11, 24], 64, 19)).toEqual(
      sampleEquity([12, 25], [11, 24], 64, 19),
    )
    expect(() => sampleEquity([12, 25], [12, 24], 50, 0)).toThrow('blocked')
  })
})
describe('generated preflop packs', () => {
  it.each([
    ['v1', 100],
    ['v1', 200],
    ['v2', 100],
    ['v2', 200],
    ['v3', 100],
    ['v3', 200],
    ['v4', 100],
    ['v4', 200],
  ] as const)(
    '%s %i bb is complete, legal, normalised, correctly labelled and certified',
    (version, depth) => {
      if (!hasPreflopPack(version)) return
      const pack = JSON.parse(readFileSync(preflopPackFile(version, depth), 'utf8')) as ReturnType<
        typeof makePack
      >
      expect(pack.version).toBe(`river-hu-preflop-${version}`)
      expect(pack.metadata.effectiveStackBb).toBe(depth)
      expect(pack.metadata.tree).toEqual(
        preflopTree(depth, version === 'v3' || version === 'v4' ? 'v3' : 'v2'),
      )
      expect(pack.nodes).toHaveLength(decisionNodes(pack.metadata.tree).length)
      const strategy = new Map(
        pack.nodes.map((node) => [
          node.id,
          Float64Array.from(node.classes.flatMap((h) => h.frequencies)),
        ]),
      )
      validateStrategy(pack.metadata.tree, strategy, 169)
      for (const node of pack.nodes)
        expect(node.classes.map((h) => h.hand)).toEqual(HAND_CLASSES.map((h) => h.name))
      expect(pack.metadata.representation.comboVsClassBrMaxDifferenceBb).toBeLessThan(1e-8)
      const certificate = pack.metadata.solver.certificate
      expect(certificate.exploitabilityBb).toBeLessThanOrEqual(0.0075)
      expect(certificate.exploitabilityBb).toBeCloseTo(
        (certificate.deviationGainBb[0] + certificate.deviationGainBb[1]) / 2,
        12,
      )
      expect(pack.metadata.solver.targetMet).toBe(true)
      expect(pack.metadata.equity.spotChecks['AA-vs-KK']).toBeCloseTo(0.82, 1)
      expect(pack.metadata.equity.spotChecks['AKs-vs-QQ']).toBeCloseTo(0.46, 1)
      expect(pack.metadata.equity.spotChecks['72o-vs-AA']).toBeCloseTo(0.12, 1)
      const dump = readFileSync(preflopPackFile(version, depth, 'txt'), 'utf8')
      expect(dump).toContain(`river-hu-preflop-${version}`)
      expect(dump).toContain('button/raise-2.5/raise-9')
      expect(pack.headlines.bbVsOpen2_5).not.toBeNull()
      if (version === 'v3' || version === 'v4') expect(pack.headlines.bbVsOpen2).not.toBeNull()
      // The big ignored cache is not required for tests in a fresh checkout.
      const cachePath = 'out/preflop-solve/equity-v1-8192.json'
      if (existsSync(cachePath)) {
        const table = JSON.parse(readFileSync(cachePath, 'utf8')) as EquityTable
        validateEquityTable(table)
        expect(pack.metadata.equity.hash).toBe(table.hash)
        const actual = bestResponseCertificate(
          pack.metadata.tree,
          table,
          strategy,
          pack.metadata.continuation.factors,
        )
        expect(actual).toEqual(certificate)
        const combos = comboBestResponseValues(
          pack.metadata.tree,
          table,
          strategy,
          pack.metadata.continuation.factors,
        )
        for (const p of [0, 1] as const)
          expect(combos[p]).toBeCloseTo(actual.bestResponseValueBb[p], 10)
        const reached = reachedFrequencies(pack.metadata.tree, table, strategy)
        for (const node of pack.nodes)
          expect(node.frequencies).toEqual(reached.get(node.id)?.frequencies)
        expect(() => loadOrGenerateEquity(cachePath, 99)).toThrow('seed/sample mismatch')
        expect(() => validateEquityTable({ ...table, hash: 'corrupted' })).toThrow('hash')
      }
    },
    60_000,
  )
})
