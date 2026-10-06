import { readFileSync, writeFileSync } from 'node:fs'
import { type BotPolicy, championPersonality, personalityPool } from '@river/engine'
import { alwaysCallPolicy, alwaysFoldPolicy, localBestResponse } from './bot-lbr.js'
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
  type RiverPolicyTuning,
  riverSolverPolicy,
} from './bot-river-policy.js'
import type { Situation } from './bot-rollout.js'
import { runSessions } from './bot-session-benchmark.js'
import { focalRotation } from './bot-session-campaign.js'
import { clusteredEstimate } from './bot-session-evaluation.js'
import { turnSolverPolicy } from './bot-turn-policy.js'
import { learnedValuePolicy, type ValueModel } from './bot-value-model.js'
import { turnNetworkFromEnvironment } from './bot-value-network.js'

// Usage: tsx bot-lbr-run.ts <v4|v5|v6|v8|v8a|v8b|v8c|v8e|v8r|v8m|v8h|v8x|v8y|v8z|v8z-forget|v9a|v9a-reads|model|call|fold> <seed> <sessions> <out.json> [hands] [rotation|champion]
// Plays one focal policy heads-up against a local best response to it. What
// the probe wins is a lower bound on how exploitable that policy is. Runs with
// the same seed deal the same cards, stacks and chairs to every focal policy,
// so their results pair hand for hand. v8z-forget is v8z with no memory of its
// opponent (forgetOpponents), so a pair of runs prices the memory.
const [focalName, seed, sessionArg, out, handArg, castName] = process.argv.slice(2)
const focalCast =
  castName === undefined || castName === 'rotation'
    ? focalRotation()
    : castName === 'champion'
      ? [championPersonality()]
      : undefined
const sessions = Number(sessionArg)
const handsPerSession = handArg === undefined ? 100 : Number(handArg)
if (
  !focalName ||
  !seed ||
  !out ||
  !Number.isSafeInteger(sessions) ||
  sessions < 2 ||
  !Number.isSafeInteger(handsPerSession) ||
  handsPerSession < 1 ||
  focalCast === undefined
) {
  throw new Error(
    'usage: <v4|v5|v6|v8|v8a|v8b|v8c|v8e|v8r|v8m|v8h|v8x|v8y|v8z|v8z-forget|v9a|v9a-reads|model|call|fold> <seed> <sessions> <out.json> [hands] [rotation|champion]',
  )
}
let riverStats: RiverPolicyStats | undefined
const river = (overrides: Partial<RiverPolicyTuning>, base: BotPolicy = pokerGuardPolicy) => {
  const solver = riverSolverPolicy(base, 'river-solver', 1, overrides)
  riverStats = solver.stats
  return solver.policy
}
const focals: Record<string, () => BotPolicy> = {
  v4: () => legacyGuardPolicy,
  v5: () => v5GuardPolicy,
  v6: () => pokerGuardPolicy,
  v8: () => river({}),
  // Development variants: some air in the opponent's range, and a second river raise.
  v8a: () => river({ opponentAir: 0.15 }),
  v8b: () => river({ opponentAir: 0.3 }),
  v8c: () => river({ opponentAir: 0.15, maxRaises: 2 }),
  v8e: () => river({ opponentAir: 0.15, betSizes: [0.33, 0.66, 1, 1.5] }),
  v8r: () => river({ maxRaises: 2 }),
  v8m: () => river({ maxRaises: 2, cardBlindPrior: 0.25, readsWidenRanges: true }),
  v8h: () =>
    river({
      maxRaises: 2,
      cardBlindPrior: 0.25,
      readsWidenRanges: true,
      extremeReadsToBase: 0.35,
      allInToBase: true,
    }),
  v8x: () => river(RIVER_READS_V8X_TUNING),
  v8y: () =>
    river({
      ...RIVER_READS_V8X_TUNING,
      exploitEvidence: 8,
      readsPriorStrength: 3,
      readsConfidenceHands: 8,
    }),
  v8z: () => river(RIVER_CANDIDATE_TUNING),
  'v8z-forget': () => river(RIVER_CANDIDATE_TUNING),
  v9a: () =>
    turnSolverPolicy(river(RIVER_CANDIDATE_TUNING), turnNetworkFromEnvironment(), 'turn-solver', 1)
      .policy,
  'v9a-reads': () =>
    turnSolverPolicy(
      river(RIVER_CANDIDATE_TUNING),
      turnNetworkFromEnvironment(),
      'turn-solver',
      1,
      {
        reads: true,
      },
    ).policy,
  'v8z-hu20': () => river(RIVER_CANDIDATE_TUNING, headsUpButtonGuardPolicy(0.2)),
  'v8z-hu12': () => river(RIVER_CANDIDATE_TUNING, headsUpButtonGuardPolicy(0.12)),
  call: () => alwaysCallPolicy,
  fold: () => alwaysFoldPolicy,
  model: () => {
    const model = JSON.parse(
      readFileSync('apps/server/models/og-action-value-v1.experimental.json', 'utf8'),
    ) as ValueModel & { margins: Record<Situation, number> }
    return learnedValuePolicy(model, { base: v5GuardPolicy, margins: model.margins })
  },
}
const make = focals[focalName]
const opponent = personalityPool()[0]
if (make === undefined || opponent === undefined) throw new Error(`unknown focal ${focalName}`)
const focal = make()
const choices: Record<string, { count: number; foldShare: number }> = {}
const probe = localBestResponse(focal, {
  onChoice: (choice) => {
    const key = `${choice.street}:${choice.kind}`
    const tally = choices[key] ?? { count: 0, foldShare: 0 }
    tally.count += 1
    tally.foldShare += choice.foldShare ?? 0
    choices[key] = tally
  },
})
const started = Date.now()
const run = runSessions({
  seed,
  sessions,
  handsPerSession,
  table: {
    name: 'heads-up-best-response',
    style: 'best-response',
    entrants: [{ personality: opponent }, { personality: opponent, policy: probe.policy }],
  },
  focalPolicy: focal,
  focalPersonalities: focalCast,
  forgetOpponents: focalName === 'v8z-forget',
  onFocalDecision: probe.watch,
  allInAdjustment: true,
  // Only the focal policies that exploit reads look at these statistics.
  ...(['v8x', 'v8y', 'v8z', 'v8z-hu20', 'v8z-hu12', 'v9a', 'v9a-reads'].includes(focalName)
    ? { plugin: opponentStatsPlugin() }
    : {}),
  onFocalHand: (session, hand) => {
    if (hand === 0 && session > 0) {
      const seconds = (Date.now() - started) / 1000
      process.stderr.write(
        `${focalName}: ${session}/${sessions} sessions, ${seconds.toFixed(0)}s\n`,
      )
    }
  },
})
const estimate = clusteredEstimate(
  run.hands.map((hand) => ({ session: hand.session, value: -hand.focalChips })),
  sessions,
)
writeFileSync(
  out,
  `${JSON.stringify({
    focal: focalName,
    seed,
    sessions,
    handsPerSession,
    estimate,
    choices,
    ...(riverStats === undefined ? {} : { river: riverStats }),
    hands: run.hands.map((hand) => [
      hand.session,
      hand.focalChips,
      hand.position,
      hand.depth,
      hand.adjustedChips ?? hand.focalChips,
    ]),
  })}\n`,
)
const [low, high] = estimate.interval95
process.stdout.write(
  `${focalName}: probe wins ${estimate.bigBlindsPer100.toFixed(1)} (${low.toFixed(1)} to ${high.toFixed(1)}) bb/100 over ${run.hands.length} hands in ${((Date.now() - started) / 1000).toFixed(0)}s\n`,
)
if (riverStats !== undefined) {
  const { solves, solved, fallbacks, trackMs, solveMs, exploitability, combos } = riverStats
  process.stdout.write(
    `river: ${solved} decisions solved, fallbacks ${JSON.stringify(fallbacks)}, ${solves} solves, ${(trackMs / Math.max(1, solves)).toFixed(0)} ms ranges and ${(solveMs / Math.max(1, solves)).toFixed(0)} ms solving each, ${(combos / Math.max(1, 2 * solves)).toFixed(0)} holdings a range, exploitable ${((100 * exploitability) / Math.max(1, solves)).toFixed(2)}% of the pot
`,
  )
}
