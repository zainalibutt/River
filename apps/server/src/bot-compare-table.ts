import { writeFileSync } from 'node:fs'
import type { BotPolicy } from '@river/engine'
import { legacyGuardPolicy, pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { clusteredEstimate, pairRuns } from './bot-session-evaluation.js'

/** Named focal policies that comparisons can refer to from the command line. */
export const COMPARABLE_POLICIES: Readonly<Record<string, BotPolicy>> = {
  v4: legacyGuardPolicy,
  v5: v5GuardPolicy,
  v6: pokerGuardPolicy,
}

// Usage: tsx bot-compare-table.ts <table> <seed prefix> <sessions> <baseline> <candidate> <out.json>
const [tableName, prefix, sessionsText, baselineName, candidateName, out] = process.argv.slice(2)
const table = [...developmentTables(), ...heldOutTables(), ...ordinaryTables()].find(
  (entry) => entry.name === tableName,
)
const baseline = COMPARABLE_POLICIES[baselineName ?? '']
const candidate = COMPARABLE_POLICIES[candidateName ?? '']
const sessions = Number(sessionsText)
if (table === undefined || baseline === undefined || candidate === undefined || !out) {
  throw new Error('usage: <table> <seed prefix> <sessions> <baseline> <candidate> <out.json>')
}
const common = {
  seed: `${prefix}-${table.name}`,
  sessions,
  handsPerSession: campaignSize(table).handsPerSession,
  table,
  focalPersonalities: focalRotation(),
}
const started = Date.now()
const base = runSessions({ ...common, focalPolicy: baseline })
const baseMs = Date.now() - started
const next = runSessions({ ...common, focalPolicy: candidate })
const nextMs = Date.now() - started - baseMs
const pairs = pairRuns(base.hands, next.hands)
const perSession = Array.from({ length: sessions }, () => [0, 0])
for (const pair of pairs) {
  const entry = perSession[pair.session] as number[]
  entry[0] = (entry[0] ?? 0) + pair.deltaChips
  entry[1] = (entry[1] ?? 0) + 1
}
const estimate = clusteredEstimate(
  pairs.map((pair) => ({ session: pair.session, value: pair.deltaChips })),
  sessions,
)
writeFileSync(
  out,
  JSON.stringify({ table: table.name, sessions, perSession, estimate, baseMs, nextMs }),
)
process.stdout.write(
  `${table.name}: ${estimate.bigBlindsPer100.toFixed(1)} (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')}), ${Math.round(nextMs / 1000)} s\n`,
)
