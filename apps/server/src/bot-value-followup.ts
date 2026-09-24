import { readFileSync } from 'node:fs'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import type { Situation } from './bot-rollout.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { clusteredEstimate, pairRuns } from './bot-session-evaluation.js'
import { learnedValuePolicy, type ValueModel } from './bot-value-model.js'

// The follow-up declared in the roadmap (packet B5): one table, 400 fresh sessions, lower bound at least -2.
const name = process.argv[2]
const table = [...heldOutTables(), ...ordinaryTables()].find((entry) => entry.name === name)
if (table === undefined) throw new Error(`unknown table ${name}`)
const model = JSON.parse(
  readFileSync('apps/server/models/og-action-value-v1.experimental.json', 'utf8'),
) as ValueModel & { margins: Record<Situation, number> }
const sessions = 400
const common = {
  seed: `b5-confirm-extra-${table.name}`,
  sessions,
  handsPerSession: campaignSize(table).handsPerSession,
  table,
  focalPersonalities: focalRotation(),
}
const base = runSessions({ ...common, focalPolicy: pokerGuardPolicy })
const learned = runSessions({
  ...common,
  focalPolicy: learnedValuePolicy(model, { base: pokerGuardPolicy, margins: model.margins }),
  plugin: opponentStatsPlugin(),
})
const estimate = clusteredEstimate(
  pairRuns(base.hands, learned.hands).map((pair) => ({
    session: pair.session,
    value: pair.deltaChips,
  })),
  sessions,
)
process.stdout.write(
  `${table.name}: hands ${estimate.hands}, learned minus version 5 ${estimate.bigBlindsPer100.toFixed(1)} (${estimate.interval95.map((value) => value.toFixed(1)).join(' to ')}) ${estimate.interval95[0] >= -2 ? 'PASS' : 'FAIL'}\n`,
)
