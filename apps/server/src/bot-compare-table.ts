import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import { runSessions, type SessionHandResult } from './bot-session-benchmark.js'
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
// A baseline written <name>@<directory> is not played again: its hands come from the piece in
// that directory that played the same baseline on the same deals (table, seed prefix, cast,
// sessions), so a fixed practice deck pays for its baseline once. A change to the baseline's
// code makes such a cache stale; the deals themselves are checked hand by hand when paired.
// Each piece reports the paired difference twice: in chips as they fell, and with an all-in
// before the river valued at its showdown share, which removes the luck of the cards to come.
const [tableName, prefix, sessionsText, baselineName, candidateName, out, firstText, castName] =
  process.argv.slice(2)
const [baselinePolicyName, baselineCache] = (baselineName ?? '').split('@')
const castLabel = castName ?? 'rotation'

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
const baseline = comparable(baselinePolicyName)
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
  allInAdjustment: true,
}
interface ComparePiece {
  readonly table: string
  readonly prefix?: string
  readonly cast?: string
  readonly baseline?: string
  readonly first: number
  readonly sessions: number
  readonly baselineHands?: SessionHandResult[]
}
/** The baseline's hands from the piece in `directory` that played it on these deals. */
function cachedBaseline(directory: string, tableName: string) {
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const piece = JSON.parse(readFileSync(join(directory, name), 'utf8')) as ComparePiece
    if (
      piece.table === tableName &&
      piece.prefix === prefix &&
      piece.cast === castLabel &&
      piece.baseline === baselinePolicyName &&
      piece.first === first &&
      piece.sessions === sessions &&
      piece.baselineHands !== undefined
    ) {
      return { hands: piece.baselineHands, from: join(directory, name) }
    }
  }
  throw new Error(`no ${baselinePolicyName} hands for ${tableName} from ${first} in ${directory}`)
}
const started = Date.now()
const cached = baselineCache === undefined ? undefined : cachedBaseline(baselineCache, table.name)
const baseHands =
  cached?.hands ??
  runSessions({
    ...common,
    focalPolicy: baseline.policy,
    forgetOpponents: baseline.forget,
  }).hands
const baseMs = Date.now() - started
const next = runSessions({
  ...common,
  focalPolicy: candidate.policy,
  forgetOpponents: candidate.forget,
})
const nextMs = Date.now() - started - baseMs
const pairs = pairRuns(baseHands, next.hands)
/** Each session's summed difference and hand count, and the estimate over the sessions. */
function summarise(deltas: readonly number[]) {
  const perSession = Array.from({ length: sessions }, () => [0, 0])
  pairs.forEach((pair, index) => {
    const entry = perSession[pair.session - first] as number[]
    entry[0] = (entry[0] ?? 0) + (deltas[index] as number)
    entry[1] = (entry[1] ?? 0) + 1
  })
  const estimate = clusteredEstimate(
    pairs.map((pair, index) => ({ session: pair.session - first, value: deltas[index] as number })),
    sessions,
  )
  return { perSession, estimate }
}
const raw = summarise(pairs.map((pair) => pair.deltaChips))
const adjusted = summarise(
  pairs.map((_, index) => {
    const before = baseHands[index] as SessionHandResult
    const after = next.hands[index] as SessionHandResult
    return (after.adjustedChips ?? after.focalChips) - (before.adjustedChips ?? before.focalChips)
  }),
)
writeFileSync(
  out,
  JSON.stringify({
    table: table.name,
    prefix,
    cast: castLabel,
    baseline: baselinePolicyName,
    candidate: candidateName,
    first,
    sessions,
    perSession: raw.perSession,
    estimate: raw.estimate,
    perSessionAdjusted: adjusted.perSession,
    estimateAdjusted: adjusted.estimate,
    baseMs,
    nextMs,
    ...(cached === undefined ? {} : { baselineFrom: cached.from }),
    baselineHands: baseHands,
  }),
)
const shown = (estimate: typeof raw.estimate) =>
  `${estimate.bigBlindsPer100.toFixed(1)} (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')})`
process.stdout.write(
  `${table.name}: ${shown(raw.estimate)}, all-in valued ${shown(adjusted.estimate)}, ${Math.round(nextMs / 1000)} s\n`,
)
