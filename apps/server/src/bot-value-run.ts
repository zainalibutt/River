import { readFileSync } from 'node:fs'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { v5GuardPolicy as pokerGuardPolicy } from './bot-poker-guard.js'
import type { Situation } from './bot-rollout.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { type ClusteredEstimate, clusteredEstimate, pairRuns } from './bot-session-evaluation.js'
import { learnedValuePolicy, type ValueModel } from './bot-value-model.js'

const confirm = process.argv[2] === '--confirm'
const model = JSON.parse(
  readFileSync('apps/server/models/og-action-value-v1.experimental.json', 'utf8'),
) as ValueModel & { margins: Record<Situation, number> }
const tables = confirm
  ? [...heldOutTables(), ...ordinaryTables()]
  : [...developmentTables(), ...ordinaryTables()]
const prefix = confirm ? 'b5-confirm' : 'b5-dev-eval'
const SESSIONS = 100
// Predeclared in the roadmap (packet B5) before any confirmation seed ran.
const GATE = { tableLowerBound: -2 } as const

const round = (value: number) => Math.round(value * 10) / 10
const shown = (estimate: ClusteredEstimate) =>
  `${round(estimate.bigBlindsPer100)} [${estimate.interval95.map(round).join(', ')}]`
const pooled: { session: number; value: number }[] = []
let clusters = 0
const started = Date.now()

const report = tables.map((table) => {
  const common = {
    seed: `${prefix}-${table.name}`,
    sessions: SESSIONS,
    handsPerSession: campaignSize(table).handsPerSession,
    table,
    focalPersonalities: focalRotation(),
  }
  const overrides: string[] = []
  const candidate = learnedValuePolicy(model, {
    base: pokerGuardPolicy,
    margins: model.margins,
    onOverride: (from, to) => overrides.push(`${from}>${to}`),
  })
  const base = runSessions({ ...common, focalPolicy: pokerGuardPolicy })
  const learned = runSessions({ ...common, focalPolicy: candidate, plugin: opponentStatsPlugin() })
  const pairs = pairRuns(base.hands, learned.hands)
  const estimate = clusteredEstimate(
    pairs.map((pair) => ({ session: pair.session, value: pair.deltaChips })),
    SESSIONS,
  )
  for (const pair of pairs)
    pooled.push({ session: clusters + pair.session, value: pair.deltaChips })
  clusters += SESSIONS
  const kinds = Object.entries(
    overrides.reduce<Record<string, number>>((counts, key) => {
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {}),
  )
  return {
    table: table.name,
    learnedMinusBase: shown(estimate),
    lowerBound: round(estimate.interval95[0]),
    upperBound: round(estimate.interval95[1]),
    overrides: overrides.length,
    overrideKinds: Object.fromEntries(kinds),
  }
})

const all = clusteredEstimate(pooled, clusters)
const gates = {
  pooled: all.interval95[0] > 0,
  everyTable: report.every((row) => row.lowerBound >= GATE.tableLowerBound),
  noClearLoss: report.every((row) => row.upperBound >= 0),
}
process.stdout.write(
  `${JSON.stringify({ mode: prefix, tables: report, pooled: shown(all), gates }, null, 1)}\n`,
)
process.stderr.write(`finished in ${Math.round((Date.now() - started) / 1000)} s\n`)
