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
  type RiverPolicyStats,
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
import { solvedFlopPolicy, solvedTurnPolicy, turnSolverPolicy } from './bot-turn-policy.js'
import { v9gPolicy } from './bot-v9g-policy.js'
import {
  loadValueNetwork,
  riverNetworkFromEnvironment,
  turnNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'

const hybridStats: Record<string, ReturnType<typeof v9gPolicy>['hybrid']> = {}
const exploitRiverStats: Record<string, RiverPolicyStats | undefined> = {}
const offTreeStats: Record<string, unknown> = {}
function v9g(name: string, options: Parameters<typeof v9gPolicy>[0] = {}): BotPolicy {
  const chain = v9gPolicy(options)
  riverStats[name] = chain.river
  hybridStats[name] = chain.hybrid
  exploitRiverStats[name] = chain.exploitRiver
  offTreeStats[name] = {
    ...(chain.preflop === undefined ? {} : { preflop: chain.preflop }),
    flop: chain.stats.offTree,
    turn: chain.turn.offTree,
    river: chain.river.offTree,
  }
  return chain.policy
}
const riverStats: Record<string, RiverPolicyStats> = {}

/** Named focal policies that comparisons can refer to from the command line. */
export const COMPARABLE_POLICIES: Readonly<Record<string, BotPolicy>> = {
  /** Inherited promises at both the flop-to-turn and turn-to-river boundaries. */
  get v9f() {
    const turnStartNetwork = turnStartNetworkFromEnvironment()
    const flop = process.env.RIVER_FLOP_NETWORK
    if (!flop)
      throw new Error('v9f needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
    return solvedFlopPolicy(turnNetworkFromEnvironment(), loadValueNetwork(flop), {
      carry: 'both',
      turnStartNetwork,
      riverNetwork: riverNetworkFromEnvironment(),
    }).policy
  },
  /** v9f at live speed: Discounted CFR with 40 rounds on the flop and the turn. */
  get v9g() {
    return v9g('v9g')
  },
  get v9go() {
    return v9g('v9go', { offTree: 'resolve' })
  },
  get v9gp() {
    return v9g('v9gp', { offTree: 'resolve', preflopTables: true })
  },
  get v9gz() {
    return v9g('v9gz', { offTree: 'resolve', preflopTables: true, safeExploitV2: true })
  },
  get v9gx() {
    return v9g('v9gx', { boundedReads: true })
  },
  get v9gy() {
    return v9g('v9gy', { boundedReads: true, baselineCaps: true })
  },
  get v9gh() {
    return v9g('v9gh', { hybridThreshold: 0.35 })
  },
  get v9gh50() {
    return v9g('v9gh50', { hybridThreshold: 0.5 })
  },
  /** v9d chain with opt-in inherited per-river turn promises. Loaded only when selected. */
  get v9e() {
    const flop = process.env.RIVER_FLOP_NETWORK
    if (!flop)
      throw new Error('v9e needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
    return solvedFlopPolicy(turnNetworkFromEnvironment(), loadValueNetwork(flop), {
      carry: 'per-river',
      riverNetwork: riverNetworkFromEnvironment(),
    }).policy
  },
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

// Usage: tsx bot-compare-table.ts <table> <seed prefix> <sessions> <baseline> <candidate: v9a|v9a-reads|v9b|v9h35|v9h50|...> <out.json> [first session] [rotation|champion]
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
  if (name === 'v9a' || name === 'v9a-reads' || name === 'v9h35' || name === 'v9h50') {
    const base = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
    return {
      policy: turnSolverPolicy(base.policy, turnNetworkFromEnvironment(), 'turn-solver', 1, {
        reads: name === 'v9a-reads',
        predictableTrust: name === 'v9h35' ? 0.35 : name === 'v9h50' ? 0.5 : null,
      }).policy,
      forget: false,
    }
  }
  if (name === 'v9b') {
    return {
      policy: solvedTurnPolicy(turnNetworkFromEnvironment(), {}, true).policy,
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
// Bounded smoke runs may override the campaign's normal session length.
const smokeHands =
  process.env.RIVER_COMPARE_HANDS === undefined
    ? undefined
    : Number(process.env.RIVER_COMPARE_HANDS)
if (smokeHands !== undefined && (!Number.isSafeInteger(smokeHands) || smokeHands < 1))
  throw new Error('RIVER_COMPARE_HANDS must be a positive integer')
if (
  table === undefined ||
  baseline === undefined ||
  candidate === undefined ||
  cast === undefined ||
  !out
) {
  throw new Error(
    'usage: <table> <seed prefix> <sessions> <baseline> <candidate: v9a|v9a-reads|v9b|v9h35|v9h50|...> <out.json> [first session] [rotation|champion]',
  )
}
const campaignHandsPerSession = campaignSize(table).handsPerSession
const common = {
  seed: `${prefix}-${table.name}`,
  sessions,
  firstSession: first,
  handsPerSession: smokeHands ?? campaignHandsPerSession,
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
  readonly handsPerSession?: number
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
      (piece.handsPerSession ?? campaignHandsPerSession) === common.handsPerSession &&
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
    handsPerSession: common.handsPerSession,
    perSession: raw.perSession,
    estimate: raw.estimate,
    perSessionAdjusted: adjusted.perSession,
    estimateAdjusted: adjusted.estimate,
    baseMs,
    nextMs,
    river: riverStats,
    offTree: offTreeStats,
    hybrid: hybridStats,
    exploitRiver: exploitRiverStats,
    ...(cached === undefined ? {} : { baselineFrom: cached.from }),
    baselineHands: baseHands,
  }),
)
const shown = (estimate: typeof raw.estimate) =>
  `${estimate.bigBlindsPer100.toFixed(1)} (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')})`
process.stdout.write(
  `${table.name}: ${shown(raw.estimate)}, all-in valued ${shown(adjusted.estimate)}, ${Math.round(nextMs / 1000)} s\n`,
)

for (const [name, stats] of Object.entries(riverStats)) {
  process.stdout.write(`${name} river: ${JSON.stringify(stats)}\n`)
}
for (const [name, stats] of Object.entries(hybridStats)) {
  if (stats !== undefined) process.stdout.write(`${name} hybrid: ${JSON.stringify(stats)}\n`)
}
for (const [name, stats] of Object.entries(exploitRiverStats)) {
  if (stats !== undefined) process.stdout.write(`${name} exploit river: ${JSON.stringify(stats)}\n`)
}
