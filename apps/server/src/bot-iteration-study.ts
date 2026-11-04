import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cardKey } from '@river/engine'
import { FLOP_DATA_TURN } from './bot-flop-end-data.js'
import {
  type CfrOptions,
  compatibleMasses,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  riverReport,
  riverValues,
  solveRiver,
  strategyRows,
} from './bot-river-solver.js'
import { comboIndex52, RIVER_DATA_SETTINGS, sampleTurnEndSpot } from './bot-river-value-data.js'
import {
  carriedRiverPromises,
  createRiverPromiseRecord,
  perRiverShowdown,
  type RiverLeafEvaluator,
} from './bot-turn-river-leaves.js'
import { loadValueNetwork, type RiverValueNetwork } from './bot-value-network.js'

const DEFAULT_K = [25, 40, 50, 100, 400]
const REFERENCE = 400

/** Two-sided Student t intervals over independent spot means, not holdings/cards. */
export function summarize(values: readonly number[]) {
  const n = values.length
  if (n === 0) return { n, mean: null, ci95: null }
  const mean = values.reduce((a, b) => a + b, 0) / n
  const t = [
    0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16,
    2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052,
    2.048, 2.045, 2.042,
  ]
  // Conservative table lookup beyond 30 degrees of freedom.
  const critical = n <= 31 ? (t[n - 1] as number) : n <= 61 ? 2.042 : n <= 121 ? 2 : 1.98
  const se = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) / n)
  return { n, mean, ci95: n < 2 ? null : [mean - critical * se, mean + critical * se] }
}

function weightedMean(values: readonly number[], weights: ArrayLike<number>): number {
  let sum = 0
  let mass = 0
  values.forEach((value, i) => {
    sum += value * (weights[i] as number)
    mass += weights[i] as number
  })
  return mass > 0 ? sum / mass : 0
}

/** Select the most probable non-all-in closed line under the reference average profile.
 * Probability uses compatible joint deals, including card removal, not product of totals. */
function closedLine(solution: RiverSolution, values: ReturnType<typeof riverValues>) {
  let chosen = { history: '', probabilityMass: -1 }
  const walk = (node: RiverNode, reach: readonly [Float64Array, Float64Array], history: string) => {
    if (node.kind !== 'action') {
      if (node.kind !== 'showdown' || Math.max(...node.paid) >= solution.spot.stack) return
      const masses = compatibleMasses(values.hands[0], values.hands[1], reach[1])
      const probabilityMass = reach[0].reduce((sum, w, h) => sum + w * (masses[h] as number), 0)
      if (probabilityMass > chosen.probabilityMass) chosen = { history, probabilityMass }
      return
    }
    const rows = strategyRows(solution, node.history)
    if (!rows) throw new Error('missing strategy')
    node.children.forEach((child, a) => {
      const next = [...reach] as [Float64Array, Float64Array]
      next[node.player] = Float64Array.from(
        reach[node.player],
        (w, h) => w * (rows[h]?.[a] as number),
      )
      walk(child, next, `${node.history}${node.actions[a]}`)
    })
  }
  walk(solution.tree, values.hands.map((h) => h.weights) as [Float64Array, Float64Array], '')
  if (chosen.probabilityMass <= 0) throw new Error('no reachable closed non-all-in line')
  return chosen.history
}

export function studySpot(
  spot: RiverSpot,
  network: RiverValueNetwork | RiverLeafEvaluator,
  iterations: readonly number[],
  scheme: NonNullable<CfrOptions['scheme']> | readonly NonNullable<CfrOptions['scheme']>[] = 'cfr+',
) {
  const counts = [...new Set(iterations)]
  const schemes = typeof scheme === 'string' ? [scheme] : scheme
  const configurations = schemes.flatMap((scheme) => counts.map((k) => ({ k, scheme })))
  if (!configurations.some((run) => run.k === REFERENCE && run.scheme === 'cfr+')) {
    configurations.push({ k: REFERENCE, scheme: 'cfr+' })
  }
  const runs = configurations.map(({ k, scheme }) => {
    const start = performance.now()
    const record = createRiverPromiseRecord()
    const evaluator = perRiverShowdown(spot, network, record)
    const solution = solveRiver(spot, k, undefined, evaluator, undefined, undefined, { scheme })
    const solveMs = performance.now() - start
    // Reporting queries do not carry a CFR visit and therefore cannot alter the record.
    return {
      k,
      scheme,
      solution,
      record,
      solveMs,
      values: riverValues(solution),
      exploitabilityPctPot: 200 * riverReport(solution).exploitability,
    }
  })
  const reference = runs.find((run) => run.k === REFERENCE && run.scheme === 'cfr+')
  if (!reference) throw new Error('missing reference')
  const line = closedLine(reference.solution, reference.values)
  const leaf = reference.record.leaves.get(line)
  if (!leaf) throw new Error('missing reference leaf')
  const cards = [...leaf.cards.keys()].sort((a, b) => a - b).slice(0, 3)
  return {
    board: spot.board.map(cardKey),
    pot: spot.pot,
    stack: spot.stack,
    promiseLine: line,
    riverCards: cards,
    runs: runs.map((run) => {
      const cfvMaePots = ([0, 1] as const).map((p) =>
        weightedMean(
          Array.from(
            run.values.values[p],
            (v, h) => Math.abs(v - (reference.values.values[p][h] as number)) / spot.pot,
          ),
          reference.values.hands[p].weights,
        ),
      )
      const root = strategyRows(run.solution, '')
      const refRoot = strategyRows(reference.solution, '')
      if (!root || !refRoot) throw new Error('missing root strategy')
      const rootTv = weightedMean(
        root.map((row, h) =>
          row.reduce((s, v, a) => s + Math.abs(v - (refRoot[h]?.[a] as number)) / 2, 0),
        ),
        reference.values.hands[0].weights,
      )
      let missingPromises = 0
      let comparedPromises = 0
      const promiseMaePots = ([0, 1] as const).map((p) => {
        const deltas: number[] = []
        for (const card of cards) {
          // p denotes whose promise is compared; carried API's player is the other player.
          const other = p === 0 ? 1 : 0
          const a = carriedRiverPromises(run.record, line, card, other)
          const b = carriedRiverPromises(reference.record, line, card, other)
          const held = reference.values.hands[p]
          for (let h = 0; h < held.combos.length; h += 1) {
            const index = comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number)
            if (b.zeroMass[index]) continue
            if (a.zeroMass[index]) {
              missingPromises += 1
              continue
            }
            deltas.push(Math.abs((a.promises[index] as number) - (b.promises[index] as number)))
            comparedPromises += 1
          }
        }
        return deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null
      })
      return {
        k: run.k,
        scheme: run.scheme,
        solveMs: run.solveMs,
        exploitabilityPctPot: run.exploitabilityPctPot,
        cfvMaePots,
        rootTv,
        promiseMaePots,
        missingPromises,
        comparedPromises,
      }
    }),
  }
}

export interface StudyOptions {
  network: string
  seed: string
  spots: number
  iterations: number[]
  scheme?: NonNullable<CfrOptions['scheme']>
  /** Benchmark both schemes with one shared CFR+ reference per spot. */
  compare?: boolean
}

export function parseArgs(args: string[]): StudyOptions {
  const positional = [...args]
  const compareIndex = positional.indexOf('--compare')
  const compare = compareIndex >= 0
  if (compare) positional.splice(compareIndex, 1)
  const schemeIndex = positional.indexOf('--scheme')
  const scheme = schemeIndex < 0 ? 'cfr+' : positional.splice(schemeIndex, 2)[1]
  const [network, seed, spotsText = '60', kText = DEFAULT_K.join(','), ...extra] = positional
  const spots = Number(spotsText)
  const iterations = kText.split(',').map(Number)
  if (
    (scheme !== 'cfr+' && scheme !== 'dcfr') ||
    !network ||
    !seed ||
    extra.length ||
    !Number.isSafeInteger(spots) ||
    spots < 1 ||
    !iterations.length ||
    iterations.some((k) => !Number.isSafeInteger(k) || k < 1)
  ) {
    throw new Error(
      'usage: bot-iteration-study.ts <river network stem> <seed> [spots=60] [K=25,40,50,100,400] [--scheme cfr+|dcfr] [--compare]',
    )
  }
  return { network, seed, spots, iterations: [...new Set(iterations)], scheme, compare }
}

export function runStudy(
  options: StudyOptions,
  network: RiverValueNetwork | RiverLeafEvaluator,
  sample: (seed: string) => RiverSpot = (seed) => ({
    ...sampleTurnEndSpot(seed, RIVER_DATA_SETTINGS),
    ...FLOP_DATA_TURN,
  }),
  progress: (message: string) => void = () => {},
) {
  const start = performance.now()
  const spots = Array.from({ length: options.spots }, (_, i) => {
    const seed = `${options.seed}:0:${i}`
    const result = studySpot(
      sample(seed),
      network,
      options.iterations,
      options.compare ? ['cfr+', 'dcfr'] : options.scheme,
    )
    progress(`spot ${i + 1}/${options.spots} complete`)
    return { seed, ...result }
  })
  const byK = spots[0]?.runs.map(({ k, scheme }, index) => {
    const rows = spots.map((s) => s.runs[index] as (typeof s.runs)[number])
    return {
      k,
      scheme,
      exploitabilityPctPot: summarize(rows.map((r) => r.exploitabilityPctPot)),
      cfvMaePots: [0, 1].map((p) => summarize(rows.map((r) => r.cfvMaePots[p] as number))),
      rootTv: summarize(rows.map((r) => r.rootTv)),
      promiseMaePots: [0, 1].map((p) =>
        summarize(
          rows.flatMap((r) => {
            const value = r.promiseMaePots[p]
            return value == null ? [] : [value]
          }),
        ),
      ),
      missingPromises: rows.reduce((sum, r) => sum + r.missingPromises, 0),
      solveMs: summarize(rows.map((r) => r.solveMs)),
    }
  })
  return {
    schemaVersion: 1,
    options,
    referenceIterations: REFERENCE,
    referenceScheme: 'cfr+',
    backend: process.env.RIVER_VALUE_BACKEND ?? 'auto',
    sampling: { settings: RIVER_DATA_SETTINGS, tree: FLOP_DATA_TURN, spotSeed: '<seed>:0:<spot>' },
    definitions: {
      exploitabilityPctPot:
        'sum of both BR gains / root pot * 100; network queried at average-profile reaches, not an unrestricted nonlinear best response',
      cfvMaePots:
        'per player, held-holding conditional root CFV absolute error / root pot, weighted by own root range',
      rootTv: 'player 0 first decision, own root-range weighted total variation',
      promiseMaePots:
        'per promised player, unweighted MAE over held holdings with compatible mass in both runs and three lowest-key river cards; units are closed-leaf pots',
      promiseSelection:
        'most likely closed non-all-in line under K=400 average profile; common line/cards for all K; missingPromises counts reference-valid comparisons invalid at K',
      ci95: 'two-sided Student t interval across spot means; null for fewer than two spots; 400 is a reference, not ground truth',
      solveMs:
        'cold independent solve including leaf preparation/recording; excludes reporting and model load; no warm starts',
    },
    byK,
    spots,
    totalMs: performance.now() - start,
  }
}

export function iterationStudyCli(
  args: string[],
  dependencies = {
    load: loadValueNetwork as (stem: string) => RiverValueNetwork | RiverLeafEvaluator,
    sample: undefined as ((seed: string) => RiverSpot) | undefined,
    output: (json: string) => {
      process.stdout.write(`${json}\n`)
    },
    progress: (message: string) => {
      process.stderr.write(`${message}\n`)
    },
  },
) {
  const options = parseArgs(args)
  const result = runStudy(
    options,
    dependencies.load(options.network),
    dependencies.sample,
    dependencies.progress,
  )
  dependencies.output(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  iterationStudyCli(process.argv.slice(2))
}
