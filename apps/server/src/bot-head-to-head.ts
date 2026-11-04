import { writeFileSync } from 'node:fs'
import { type BotPersonality, type BotPolicy, championPersonality } from '@river/engine'
import { beginBenchmark } from './bot-benchmark-provenance.js'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { runSessions, type SessionHandResult } from './bot-session-benchmark.js'
import { clusteredEstimate } from './bot-session-evaluation.js'
import { solvedFlopPolicy, solvedTurnPolicy } from './bot-turn-policy.js'
import { V9GP_POLICY_OPTIONS, v9gPolicy } from './bot-v9g-policy.js'
import { loadValueNetwork, turnNetworkFromEnvironment } from './bot-value-network.js'

// Usage: tsx bot-head-to-head.ts <A> <B> <seed prefix> <sessions> <out.json> [first session] [hands a session]
// Two policies play each other heads-up as duplicate poker: every session's deals are played
// twice, once with A in the first seat and once with the policies swapped, so each gets the
// cards the other had. Both play as the champion, with the same public reads of each other.
// A hand's score for A is half of (A's chips in the first run minus B's chips in the second),
// all-in valued; the estimate clusters by session. Policies: v8z, v9a, v9b, v9c, and v9d,
// plus v9g, v9go, v9gp, v9gpw (warm flop re-solves), v9gpw2 (warm, 2x iterations), and
// any v9gp name with @<dir> to play the preflop packs in that directory.
// v9d and the v9g policies also need RIVER_FLOP_NETWORK, the flop-end network's export without .bin.
const [nameA, nameB, prefix, sessionsText, out, firstText = '0', handsText = '100'] =
  process.argv.slice(2)

/** A fresh instance of a named policy, so the two runs share no caches. */
export function headToHeadPolicy(name: string): BotPolicy | undefined {
  // `v9gpw2@<dir>` plays v9gpw2 with the preflop packs in <dir> (<dir>/100bb.json and
  // 200bb.json), so a re-solved pack can meet the one in play.
  const at = name.indexOf('@')
  if (at > 0) {
    const base = name.slice(0, at)
    const dir = name.slice(at + 1)
    if ((base !== 'v9gp' && base !== 'v9gpw' && base !== 'v9gpw2') || dir === '') return undefined
    return v9gPolicy({ ...V9GP_POLICY_OPTIONS[base], preflopPackDir: dir }).policy
  }
  if (name === 'v9g') return v9gPolicy().policy
  if (name === 'v9go') return v9gPolicy({ offTree: 'resolve' }).policy
  if (name === 'v9gp' || name === 'v9gpw' || name === 'v9gpw2')
    return v9gPolicy(V9GP_POLICY_OPTIONS[name]).policy
  const v8z = () =>
    riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING).policy
  if (name === 'v8z') return v8z()
  if (name === 'v9a') return solvedTurnPolicy(turnNetworkFromEnvironment(), {}, false).policy
  if (name === 'v9b') return solvedTurnPolicy(turnNetworkFromEnvironment(), {}, true).policy
  if (name === 'v9c') return solvedTurnPolicy(turnNetworkFromEnvironment(), {}, true, true).policy
  if (name === 'v9d') {
    const flop = process.env.RIVER_FLOP_NETWORK
    if (flop === undefined || flop === '') throw new Error('v9d needs RIVER_FLOP_NETWORK')
    return solvedFlopPolicy(turnNetworkFromEnvironment(), loadValueNetwork(flop)).policy
  }
  return undefined
}

/** The champion, and a twin with its own player id so the two can sit at one table. */
export function championPair(): readonly [BotPersonality, BotPersonality] {
  const champion = championPersonality()
  return [champion, { ...champion, id: `${champion.id}-twin`, name: `${champion.name} II` }]
}

/** One run of the deals with `first` in the focal seat and `second` opposite. */
export function playDeals(
  first: BotPolicy,
  second: BotPolicy,
  seed: string,
  sessions: number,
  firstSession: number,
  handsPerSession: number,
): readonly SessionHandResult[] {
  const [champion, twin] = championPair()
  return runSessions({
    seed,
    sessions,
    firstSession,
    handsPerSession,
    plugin: opponentStatsPlugin(),
    table: {
      name: 'heads-up-duplicate',
      style: 'plain',
      entrants: [
        { personality: champion },
        { personality: twin, policy: second, memory: opponentStatsPlugin() },
      ],
    },
    focalPersonalities: [champion],
    focalPolicy: first,
    allInAdjustment: true,
    chanceCorrection: true,
    aivat: true,
  }).hands
}

/** Each hand's duplicate score for the first run's focal policy, in chips. */
export function duplicateScores(
  forward: readonly SessionHandResult[],
  mirrored: readonly SessionHandResult[],
): { session: number; value: number; raw: number; corrected?: number; aivat?: number }[] {
  if (forward.length !== mirrored.length) throw new Error('the two runs played different hands')
  return forward.map((hand, index) => {
    const other = mirrored[index] as SessionHandResult
    if (other.session !== hand.session || other.hand !== hand.hand) {
      throw new Error('the two runs are out of step')
    }
    const a = hand.adjustedChips ?? hand.focalChips
    const b = other.adjustedChips ?? other.focalChips
    const ca = hand.correctedChips
    const cb = other.correctedChips
    return {
      session: hand.session,
      value: (a - b) / 2,
      raw: (hand.focalChips - other.focalChips) / 2,
      ...(hand.aivatChips === undefined || other.aivatChips === undefined
        ? {}
        : {
            aivat: (hand.aivatChips - other.aivatChips) / 2,
          }),
      ...(ca === undefined || cb === undefined ? {} : { corrected: (ca - cb) / 2 }),
    }
  })
}

if (process.argv[1]?.endsWith('bot-head-to-head.ts')) {
  const record = out
    ? beginBenchmark(out, 'duplicate', {
        policies: [nameA ?? '', nameB ?? ''],
        seeds: [`${prefix}-h2h`],
        plannedHands: Number(sessionsText) * Number(handsText),
        settings: {
          first: Number(firstText),
          sessions: Number(sessionsText),
          handsPerSession: Number(handsText),
        },
      })
    : undefined
  const a = headToHeadPolicy(nameA ?? '')
  const b = headToHeadPolicy(nameB ?? '')
  const mirrorA = headToHeadPolicy(nameA ?? '')
  const mirrorB = headToHeadPolicy(nameB ?? '')
  const sessions = Number(sessionsText)
  const first = Number(firstText)
  const hands = Number(handsText)
  if (!a || !b || !mirrorA || !mirrorB || !prefix || !out || !Number.isSafeInteger(sessions)) {
    throw new Error(
      'usage: <A> <B> <seed prefix> <sessions> <out.json> [first session] [hands a session]; policies v8z, v9a, v9b, v9c, v9d, v9g, v9go, v9gp, v9gpw, v9gpw2',
    )
  }
  const seed = `${prefix}-h2h`
  const started = Date.now()
  const forward = playDeals(a, b, seed, sessions, first, hands)
  const mirrored = playDeals(mirrorB, mirrorA, seed, sessions, first, hands)
  const scores = duplicateScores(forward, mirrored)
  const estimate = clusteredEstimate(
    scores.map((row) => ({ session: row.session - first, value: row.value })),
    sessions,
  )
  const corrected = clusteredEstimate(
    scores.map((row) => ({ session: row.session - first, value: row.corrected ?? row.value })),
    sessions,
  )
  writeFileSync(
    out,
    JSON.stringify({
      a: nameA,
      b: nameB,
      prefix,
      first,
      sessions,
      hands,
      estimate,
      corrected,
      scores,
      forward,
      mirrored,
      provenance: record?.provenance,
      raw: clusteredEstimate(
        scores.map((row) => ({ session: row.session - first, value: row.raw })),
        sessions,
      ),
      aivat: clusteredEstimate(
        scores.map((row) => ({ session: row.session - first, value: row.aivat ?? row.raw })),
        sessions,
      ),
    }),
  )
  record?.finish(scores.length)
  process.stdout.write(
    `${nameA} vs ${nameB}, sessions ${first}-${first + sessions - 1}: ${estimate.bigBlindsPer100.toFixed(1)} bb/100 (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')}), ${Math.round((Date.now() - started) / 1000)} s\n`,
  )
}
