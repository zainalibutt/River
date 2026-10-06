import { writeFileSync } from 'node:fs'
import { type BotPolicy, championPersonality } from '@river/engine'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import {
  headsUpButtonGuardPolicy,
  legacyGuardPolicy,
  pokerGuardPolicy,
  v5GuardPolicy,
} from './bot-poker-guard.js'
import {
  RIVER_CANDIDATE_TUNING,
  RIVER_READS_V8X_TUNING,
  riverSolverPolicy,
} from './bot-river-policy.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { clusteredEstimate, pairRuns } from './bot-session-evaluation.js'
import { turnSolverPolicy } from './bot-turn-policy.js'
import { turnNetworkFromEnvironment } from './bot-value-network.js'

/** Named focal policies that comparisons can refer to from the command line. */
export const COMPARABLE_POLICIES: Readonly<Record<string, BotPolicy>> = {
  v4: legacyGuardPolicy,
  v5: v5GuardPolicy,
  v6: pokerGuardPolicy,
  /** v6 with the river solved at two-player rivers, allowing a re-raise; a development candidate. */
  v8r: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, { maxRaises: 2 }).policy,
  /** As v8r, with 15% of the opponent's range spread evenly; the development candidate. */
  v8c: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, { opponentAir: 0.15, maxRaises: 2 })
    .policy,
  /** A re-raise, a 25% chance that any opponent move ignored the cards, more for aggressive reads. */
  v8m: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, {
    maxRaises: 2,
    cardBlindPrior: 0.25,
    readsWidenRanges: true,
  }).policy,
  /** As v8m, leaving extreme readers and all-ins to v6. */
  v8h: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, {
    maxRaises: 2,
    cardBlindPrior: 0.25,
    readsWidenRanges: true,
    extremeReadsToBase: 0.35,
    allInToBase: true,
  }).policy,
  /** As v8m, exploiting what the reads say about the opponent's river play. */
  v8x: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_READS_V8X_TUNING).policy,
  /** As v8x, with reads that count sooner. */
  v8y: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, {
    ...RIVER_READS_V8X_TUNING,
    exploitEvidence: 8,
    readsPriorStrength: 3,
    readsConfidenceHands: 8,
  }).policy,
  /** As v8y, with fold rates by the size of the bet faced: the candidate under confirmation. */
  v8z: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING).policy,
  /** v8z with the heads-up button folding only the weakest 20% of starting hands. */
  'v8z-hu20': riverSolverPolicy(
    headsUpButtonGuardPolicy(0.2),
    'river-solver',
    1,
    RIVER_CANDIDATE_TUNING,
  ).policy,
  /** As v8z-hu20, folding only the weakest 12%. */
  'v8z-hu12': riverSolverPolicy(
    headsUpButtonGuardPolicy(0.12),
    'river-solver',
    1,
    RIVER_CANDIDATE_TUNING,
  ).policy,
}

// Usage: tsx bot-compare-table.ts <table> <seed prefix> <sessions> <baseline> <candidate> <out.json> [first session] [rotation|champion]
// With a first session, the run covers sessions first to first + sessions - 1 of the table,
// so a long table can be split across processes; bot-compare-pool.ts joins the pieces.
// A policy name ending in -forget plays that policy with no memory of its opponents
// (see forgetOpponents), from its own instance so no cache is shared with the other run.
const [tableName, prefix, sessionsText, baselineName, candidateName, out, firstText, castName] =
  process.argv.slice(2)

function comparable(name: string | undefined): { policy: BotPolicy; forget: boolean } | undefined {
  if (name === 'v9a' || name === 'v9a-reads') {
    const base = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
    return {
      policy: turnSolverPolicy(base.policy, turnNetworkFromEnvironment(), 'turn-solver', 1, {
        reads: name === 'v9a-reads',
      }).policy,
      forget: false,
    }
  }
  if (name === 'v8z-forget') {
    return {
      policy: riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING).policy,
      forget: true,
    }
  }
  const policy = COMPARABLE_POLICIES[name ?? '']
  return policy === undefined ? undefined : { policy, forget: false }
}
const table = [...developmentTables(), ...heldOutTables(), ...ordinaryTables()].find(
  (entry) => entry.name === tableName,
)
const baseline = comparable(baselineName)
const candidate = comparable(candidateName)
const cast =
  castName === undefined || castName === 'rotation'
    ? focalRotation()
    : castName === 'champion'
      ? [championPersonality()]
      : undefined
const sessions = Number(sessionsText)
const first = firstText === undefined ? 0 : Number(firstText)
if (
  table === undefined ||
  baseline === undefined ||
  candidate === undefined ||
  cast === undefined ||
  !out
) {
  throw new Error(
    'usage: <table> <seed prefix> <sessions> <baseline> <candidate> <out.json> [first session] [rotation|champion]',
  )
}
const common = {
  seed: `${prefix}-${table.name}`,
  sessions,
  firstSession: first,
  handsPerSession: campaignSize(table).handsPerSession,
  // The focal seat keeps the public statistics a live bot would; policies that do not read them are unaffected.
  plugin: opponentStatsPlugin(),
  table,
  focalPersonalities: cast,
}
const started = Date.now()
const base = runSessions({
  ...common,
  focalPolicy: baseline.policy,
  forgetOpponents: baseline.forget,
})
const baseMs = Date.now() - started
const next = runSessions({
  ...common,
  focalPolicy: candidate.policy,
  forgetOpponents: candidate.forget,
})
const nextMs = Date.now() - started - baseMs
const pairs = pairRuns(base.hands, next.hands)
const perSession = Array.from({ length: sessions }, () => [0, 0])
for (const pair of pairs) {
  const entry = perSession[pair.session - first] as number[]
  entry[0] = (entry[0] ?? 0) + pair.deltaChips
  entry[1] = (entry[1] ?? 0) + 1
}
const estimate = clusteredEstimate(
  pairs.map((pair) => ({ session: pair.session - first, value: pair.deltaChips })),
  sessions,
)
writeFileSync(
  out,
  JSON.stringify({ table: table.name, first, sessions, perSession, estimate, baseMs, nextMs }),
)
process.stdout.write(
  `${table.name}: ${estimate.bigBlindsPer100.toFixed(1)} (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')}), ${Math.round(nextMs / 1000)} s\n`,
)
