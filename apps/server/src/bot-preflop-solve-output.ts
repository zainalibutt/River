import { createHash } from 'node:crypto'
import type { Certificate } from './bot-preflop-solve-br.js'
import type { DealModel, PreflopStrategy } from './bot-preflop-solve-cfr.js'
import { type EquityTable, HAND_CLASSES } from './bot-preflop-solve-equity.js'
import { isHandRealisation } from './bot-preflop-solve-realisation.js'
import { decisionNodes, type PreflopNode, type Realisation } from './bot-preflop-solve-tree.js'
export const PACK_VERSION = 'river-hu-preflop-v2'
/** Frequencies CONDITIONED ON BOTH reaches and the legal joint deal, not raw combo averages. */
export function reachedFrequencies(
  tree: PreflopNode,
  model: DealModel,
  strategy: PreflopStrategy,
): ReadonlyMap<
  string,
  {
    reachProbability: number
    frequencies: readonly number[]
  }
> {
  const n = model.classes.length
  const total = model.deals.reduce((a, b) => a + b, 0)
  const out = new Map<
    string,
    {
      reachProbability: number
      frequencies: readonly number[]
    }
  >()
  const walk = (node: PreflopNode, reach: readonly [Float64Array, Float64Array]): void => {
    if (node.kind !== 'decision') return
    const policy = strategy.get(node.id) as Float64Array
    const width = node.actions.length
    const frequencies = new Array<number>(width).fill(0)
    let mass = 0
    for (let a = 0; a < n; a += 1) {
      for (let b = 0; b < n; b += 1) {
        const weight =
          (model.deals[a * n + b] as number) * (reach[0][a] as number) * (reach[1][b] as number)
        mass += weight
        const h = node.player === 0 ? a : b
        for (let k = 0; k < width; k += 1)
          frequencies[k] = (frequencies[k] as number) + weight * (policy[h * width + k] as number)
      }
    }
    out.set(node.id, {
      reachProbability: mass / total,
      frequencies: frequencies.map((v) => (mass > 0 ? v / mass : 0)),
    })
    node.children.forEach((child, k) => {
      const next: [Float64Array, Float64Array] = [reach[0], reach[1]]
      next[node.player] = Float64Array.from(
        reach[node.player],
        (r, h) => r * (policy[h * width + k] as number),
      )
      walk(child, next)
    })
  }
  walk(tree, [new Float64Array(n).fill(1), new Float64Array(n).fill(1)])
  return out
}
export function makePack(options: {
  depth: number
  tree: PreflopNode
  table: EquityTable
  factors: Realisation
  strategy: PreflopStrategy
  iterations: number
  seconds: number
  certificate: Certificate
  comboBestResponse: readonly [number, number]
  target: number
  checkpoints: readonly {
    iterations: number
    seconds: number
    exploitabilityBb: number
  }[]
}) {
  const { depth, tree, table, factors, strategy, certificate, target } = options
  const reached = reachedFrequencies(tree, table, strategy)
  const nodes = decisionNodes(tree).map((node) => ({
    id: node.id,
    player: node.player === 0 ? 'button-ip' : 'bb-oop',
    actions: node.actions,
    ...reached.get(node.id),
    classes: HAND_CLASSES.map((hand, h) => ({
      hand: hand.name,
      frequencies: Array.from(
        (strategy.get(node.id) as Float64Array<ArrayBufferLike>).slice(
          h * node.actions.length,
          (h + 1) * node.actions.length,
        ),
      ),
    })),
  }))
  const headline = (id: string) => {
    const node = nodes.find((n) => n.id === id)
    return node
      ? Object.fromEntries(node.actions.map((a, i) => [a.label, node.frequencies?.[i]]))
      : null
  }
  return {
    version: isHandRealisation(factors) ? PACK_VERSION : 'river-hu-preflop-v1',
    metadata: {
      game: 'Heads-up NLHE, no rake/ante, blinds 0.5/1 bb',
      effectiveStackBb: depth,
      tree,
      continuation: {
        formula:
          'pot * equity(own holding vs compatible opponent reach at this node) * realisation - own total contribution',
        factors,
        realisationFormula: isHandRealisation(factors)
          ? 'q=clamp((rangeEquity-floor)/(ceiling-floor),0,1)^power; deep=base[position,potType]+equitySlope[position,potType]*q+dot(featureWeights,handFeatures); R=clamp(1+SPR/(SPR+sprHalfLife)*(deep-1),min,max); SPR=(depth-matchedContribution)/pot. See v2/README.md for hand features.'
          : 'R=ip or oop; all-in R=1',
        configHash: createHash('sha256').update(JSON.stringify(factors)).digest('hex'),
        factorSource: isHandRealisation(factors)
          ? 'Public illustrative EQR estimates plus explicit uncalibrated priors. See v2/README.md for sources, formula, parameters, uncertainty and JSON calibration format.'
          : 'Legacy flat factors; tunable assumptions, not empirical poker estimates.',
        sources: isHandRealisation(factors)
          ? [
              'https://blog.gtowizard.com/what-is-equity-in-poker/',
              'https://blog.gtowizard.com/equity-realization/',
              'https://blog.gtowizard.com/stack-to-pot-ratio/',
            ]
          : [],
        allIn:
          'Unadjusted showdown equity from the same cached Monte Carlo table; no realisation factor. Not exhaustive board enumeration.',
        gameType:
          'general-sum when realisation differs from 1; shares are not normalised or clipped',
        averaging: isHandRealisation(factors)
          ? 'Nonlinear opponent-range model: compute compatible reach mass and mean equity first, then R(hand, mean equity, position, pot type, SPR). Recompute at every traversal and for exported average-strategy best responses. Never average pairwise R or training-time utilities. No CFR convergence guarantee.'
          : 'Fixed factors make terminal payoff linear in opponent reach. Averaging terminal pair equity equals equity against the actual card-conditioned node range.',
      },
      equity: {
        version: table.version,
        hash: table.hash,
        seed: table.seed,
        samplesPerOrbit: table.samplesPerOrbit,
        orbits: table.orbits,
        error: table.error,
        generationSeconds: table.generationSeconds,
        cache: `out/preflop-solve/equity-v1-${table.samplesPerOrbit}.json (ignored; regenerate with the CLI)`,
        spotChecks: Object.fromEntries(
          [
            ['AA', 'KK'],
            ['AKs', 'QQ'],
            ['72o', 'AA'],
          ].map(([a, b]) => [
            `${a}-vs-${b}`,
            table.equity[
              table.classes.indexOf(a as string) * 169 + table.classes.indexOf(b as string)
            ],
          ]),
        ),
      },
      representation: {
        physicalCombosPerPlayer: 1326,
        legalOrderedDeals: 1326 * 1225,
        classes: 169,
        ordering: '13x13 AKQJT98765432; pairs diagonal, suited above diagonal, offsuit below',
        comboRule:
          'All suit permutations within a class have the same policy. Expand using classCombos. No per-combo differences in this suit-invariant model.',
        justification:
          'Exact legal-combo weights and suit-orbit equity averages form a symmetry quotient. Every physical hero combo has the same conditional equity and compatible counts against any class-symmetric opponent range.',
        comboBestResponseValueBb: options.comboBestResponse,
        comboVsClassBrMaxDifferenceBb: Math.max(
          ...options.comboBestResponse.map((v, i) =>
            Math.abs(v - (certificate.bestResponseValueBb[i] as number)),
          ),
        ),
      },
      solver: {
        algorithm: 'Alternating range-vector DCFR(1.5,0,2), full deal integration',
        reference: 'https://arxiv.org/abs/1809.04040',
        iterations: options.iterations,
        runtimeSeconds: options.seconds,
        threads: 1,
        targetExploitabilityBb: target,
        targetMet: certificate.exploitabilityBb <= target,
        certificate,
        certificateScope:
          'Independent best responses to the exported average strategy, under the cached equity and continuation model, within the documented action tree. No certificate for real postflop poker or equity estimation error.',
        checkpoints: options.checkpoints,
      },
    },
    headlines: {
      button: headline('button'),
      bbVsOpen2_5: headline('button/raise-2.5'),
      bbVsLimp: headline('button/limp'),
    },
    classCombos: HAND_CLASSES.map((h) => ({ hand: h.name, cards: h.combos })),
    nodes,
  }
}
const LETTERS: Readonly<Record<string, string>> = {
  fold: 'F',
  limp: 'L',
  check: 'K',
  call: 'C',
  jam: 'J',
  'raise-2.5': 'O',
  'raise-4': 'R',
  'raise-9': 'T',
  'raise-22': 'Q',
}
export function gridDump(
  depth: number,
  tree: PreflopNode,
  strategy: PreflopStrategy,
  version = PACK_VERSION,
): string {
  const nodes = decisionNodes(tree)
  const wanted = ['button', 'button/limp', 'button/raise-2.5', 'button/raise-2.5/raise-9']
  const lines = [
    `${version}: ${depth} bb`,
    'Rows/columns AKQJT98765432. Pairs diagonal; suited above; offsuit below.',
    'F fold, L limp, K check, C call, O open 2.5, R raise 4, T 3bet 9, Q 4bet 22, J jam.',
    'Cells show all actions >=10%, or the largest action. Whole percentages; JSON is authoritative.',
  ]
  for (const id of wanted) {
    const node = nodes.find((n) => n.id === id)
    if (!node) continue
    lines.push(
      '',
      id,
      `     ${'AKQJT98765432'
        .split('')
        .map((r) => r.padStart(11))
        .join(' ')}`,
    )
    const policy = strategy.get(id) as Float64Array
    for (let row = 0; row < 13; row += 1) {
      const cells: string[] = []
      for (let col = 0; col < 13; col += 1) {
        const h = row * 13 + col
        const actions = node.actions
          .map((action, a) => ({
            label: LETTERS[action.label] ?? action.label,
            p: policy[h * node.actions.length + a] as number,
          }))
          .sort((a, b) => b.p - a.p)
        cells.push(
          actions
            .filter((a, i) => i === 0 || a.p >= 0.1)
            .map((a) => `${a.label}${Math.round(100 * a.p)}`)
            .join('/')
            .padStart(11),
        )
      }
      lines.push(`${'AKQJT98765432'[row]}    ${cells.join(' ')}`)
    }
  }
  return `${lines.join('\n')}\n`
}
