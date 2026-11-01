import { appendFileSync, existsSync } from 'node:fs'
import {
  type BotPolicy,
  championPersonality,
  mulberry32,
  parseCard,
  seedFromString,
} from '@river/engine'
import type { AivatDecision } from './bot-aivat.js'
import { beginBenchmark } from './bot-benchmark-provenance.js'
import { pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import { releasePolicyHand } from './bot-policy-hand.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { botPlayerId } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { slumbotIncrement, slumbotMemory } from './bot-slumbot.js'
import { type TurnPolicyStats, turnSolverPolicy } from './bot-turn-policy.js'
import { V9GP_POLICY_OPTIONS, v9gPolicy } from './bot-v9g-policy.js'
import { turnNetworkFromEnvironment } from './bot-value-network.js'

// Usage: tsx bot-slumbot-run.ts <v5|v6|v8z|v9a|v9g|v9go|v9gp|v9gpw|v9gpw2|v9gz> <hands> <run seed> <out.jsonl> [rotation|champion] [reads]
// v9gpw warms flop re-solves; v9gpw2 also doubles flop/turn iterations.
// Plays hands against Slumbot's public heads-up API, one at a time, sending
// only our own moves; Slumbot deals and reports our cards. Each finished hand
// is appended to the output file as one JSON line. A hand that fails, on our
// side or Slumbot's, is logged to <out>.errors.jsonl, left unfinished and not
// counted, and the run carries on.
//
// The cast is the OG rotation the session campaigns use, or the champion
// alone. Without `reads` the bot remembers nothing between hands, and plays
// every hand the way it plays the first hands against somebody new. With it,
// the bot keeps what a table keeps of an opponent (see `slumbotMemory`), as it
// does in the session campaigns and at River's live tables. v9a solves every
// turn with the turn-end network named by RIVER_TURN_NETWORK, and plays v8z
// everywhere else.
const [focalName, handText, runSeed, out, castName = 'rotation', readsName] = process.argv.slice(2)
const hands = Number(handText)
const v8z = () => riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
let turnStats: TurnPolicyStats | undefined
let offTree: unknown
let riverStats: ReturnType<typeof v9gPolicy>['river'] | undefined
const policies: Record<string, () => BotPolicy> = {
  v5: () => v5GuardPolicy,
  v6: () => pokerGuardPolicy,
  v8z: () => v8z().policy,
  v9a: () => {
    const solver = turnSolverPolicy(v8z().policy, turnNetworkFromEnvironment(), 'turn-solver', 1)
    turnStats = solver.stats
    return solver.policy
  },
  // The safe chain at live speed: carried promises at both boundaries, DCFR 40 (bot-v9g-policy.ts).
  v9g: () => v9gPolicy().policy,
  v9go: () => {
    const chain = v9gPolicy({ offTree: 'resolve' })
    offTree = { flop: chain.stats.offTree, turn: chain.turn.offTree, river: chain.river.offTree }
    return chain.policy
  },
  v9gp: () => {
    const chain = v9gPolicy(V9GP_POLICY_OPTIONS.v9gp)
    offTree = {
      flop: chain.stats.offTree,
      turn: chain.turn.offTree,
      river: chain.river.offTree,
      preflop: chain.preflop,
    }
    return chain.policy
  },
  v9gpw: () => {
    const chain = v9gPolicy(V9GP_POLICY_OPTIONS.v9gpw)
    offTree = {
      flop: chain.stats.offTree,
      turn: chain.turn.offTree,
      river: chain.river.offTree,
      preflop: chain.preflop,
    }
    return chain.policy
  },
  v9gpw2: () => {
    const chain = v9gPolicy(V9GP_POLICY_OPTIONS.v9gpw2)
    offTree = {
      flop: chain.stats.offTree,
      turn: chain.turn.offTree,
      river: chain.river.offTree,
      preflop: chain.preflop,
    }
    return chain.policy
  },
  v9gz: () => {
    const chain = v9gPolicy({ offTree: 'resolve', preflopTables: true, safeExploitV2: true })
    riverStats = chain.river
    offTree = {
      flop: chain.stats.offTree,
      turn: chain.turn.offTree,
      river: chain.river.offTree,
      preflop: chain.preflop,
    }
    return chain.policy
  },
  v9gz2: () => {
    const chain = v9gPolicy({
      offTree: 'resolve',
      preflopTables: true,
      safeExploitV2: true,
      safeTurnExploit: true,
    })
    riverStats = chain.river
    turnStats = chain.turn
    offTree = {
      flop: chain.stats.offTree,
      turn: chain.turn.offTree,
      river: chain.river.offTree,
      preflop: chain.preflop,
    }
    return chain.policy
  },
}
const make = policies[focalName ?? '']
const casts = { rotation: focalRotation, champion: () => [championPersonality()] }
const cast = castName === 'rotation' || castName === 'champion' ? casts[castName] : undefined
if (
  make === undefined ||
  cast === undefined ||
  !Number.isSafeInteger(hands) ||
  hands < 1 ||
  !runSeed ||
  !out ||
  (readsName !== undefined && readsName !== 'reads')
) {
  throw new Error(
    'usage: <v5|v6|v8z|v9a|v9g|v9go|v9gp|v9gpw|v9gpw2|v9gz> <hands> <run seed> <out.jsonl> [rotation|champion] [reads]',
  )
}
if (existsSync(out)) throw new Error('refusing to append a new run to an existing Slumbot log')
const record = beginBenchmark(out, 'slumbot', {
  policies: [focalName ?? ''],
  seeds: [runSeed],
  plannedHands: hands,
  settings: { cast: castName, reads: readsName === 'reads', dealSeedsControlled: false },
})
const policy = make()
const memory = readsName === 'reads' ? slumbotMemory() : null
let unobserved = 0

interface SlumbotResponse {
  readonly token?: string
  readonly action: string
  readonly client_pos: 0 | 1
  readonly hole_cards: readonly string[]
  readonly board: readonly string[]
  readonly winnings?: number
  readonly bot_hole_cards?: readonly string[]
  readonly error_msg?: string
}

// A move is not sent twice: when Slumbot is slow, a request can time out after
// Slumbot has applied it, and the same move sent again is refused against the
// hand as it now stands ("Illegal call", "Unexpected action"), which costs the
// whole hand. So a move waits longer and is never retried; only dealing a new
// hand is, since a lost deal just leaves that hand unplayed.
async function post(path: 'new_hand' | 'act', body: object): Promise<SlumbotResponse> {
  const attempts = path === 'act' ? 1 : 3
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`https://slumbot.com/slumbot/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const parsed = (await response.json()) as SlumbotResponse
      if (parsed.error_msg !== undefined) throw new Error(`Slumbot: ${parsed.error_msg}`)
      return parsed
    } catch (error) {
      if (attempt >= attempts || String(error).includes('Slumbot:')) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

const rotation = cast()
let token: string | undefined
let total = 0
let failed = 0
const started = Date.now()
for (let hand = 0; hand < hands; hand += 1) {
  const personality = rotation[hand % rotation.length]
  if (personality === undefined) throw new Error('no OG personality')
  const rng = mulberry32(seedFromString(`slumbot:${runSeed}:${hand}`))
  let state: SlumbotResponse | undefined
  let incr = ''
  const aivatDecisions: AivatDecision[] = []
  const remembered = memory?.options() ?? {}
  try {
    state = await post('new_hand', token === undefined ? {} : { token })
    token = state.token ?? token
    for (let step = 0; state.winnings === undefined; step += 1) {
      if (step > 40) throw new Error(`hand did not finish: ${state.action}`)
      incr = slumbotIncrement(
        {
          action: state.action,
          clientPos: state.client_pos,
          hole: state.hole_cards.map(parseCard),
          board: state.board.map(parseCard),
        },
        policy,
        personality,
        rng,
        { ...remembered, aivat: (decision) => aivatDecisions.push(decision) },
      )
      state = await post('act', { token, incr })
      token = state.token ?? token
    }
  } catch (error) {
    failed += 1
    record.progress(hand - failed + 1, failed + unobserved)
    // Every Slumbot hand is replayed as hand 1 of room 'slumbot', so release it here.
    releasePolicyHand(policy, 'slumbot', 1)
    appendFileSync(
      `${out}.errors.jsonl`,
      `${JSON.stringify({ hand, action: state?.action ?? null, clientPos: state?.client_pos ?? null, hole: state?.hole_cards ?? null, board: state?.board ?? null, incr, error: String(error) })}\n`,
    )
    continue
  }
  releasePolicyHand(policy, 'slumbot', 1)
  if (state?.winnings === undefined) continue
  total += state.winnings
  if (memory !== null) {
    const finished = state
    try {
      memory.observe(
        {
          action: finished.action,
          clientPos: finished.client_pos,
          hole: finished.hole_cards.map(parseCard),
          board: finished.board.map(parseCard),
          ...(finished.bot_hole_cards === undefined
            ? {}
            : { theirHole: finished.bot_hole_cards.map(parseCard) }),
        },
        botPlayerId(personality.id),
        hand,
      )
    } catch (error) {
      // The hand still counts; only the memory misses it.
      unobserved += 1
      appendFileSync(
        `${out}.errors.jsonl`,
        `${JSON.stringify({ hand, observe: String(error), action: finished.action })}\n`,
      )
    }
  }
  appendFileSync(
    out,
    `${JSON.stringify({
      hand,
      focal: focalName,
      personality: personality.id,
      reads: memory !== null,
      clientPos: state.client_pos,
      hole: state.hole_cards,
      slumbotHole: state.bot_hole_cards ?? null,
      board: state.board,
      action: state.action,
      winnings: state.winnings,
      aivatDecisions,
      provenanceSha256: record.provenance.sourceSha256,
    })}\n`,
  )
  if ((hand + 1) % 50 === 0 || hand + 1 === hands) {
    record.progress(hand + 1 - failed, failed + unobserved)
    const seconds = Math.round((Date.now() - started) / 1000)
    if (offTree !== undefined) process.stderr.write(`off tree: ${JSON.stringify(offTree)}\n`)
    if (riverStats !== undefined) process.stderr.write(`river: ${JSON.stringify(riverStats)}\n`)
    if (focalName === 'v9gz2')
      process.stderr.write(`turn safe exploit: ${JSON.stringify(turnStats?.safeExploit)}\n`)
    process.stderr.write(
      `${focalName}: ${hand + 1}/${hands} hands, ${((total / 100 / (hand + 1 - failed)) * 100).toFixed(1)} bb/100 so far, ${failed} failed, ${memory === null ? 'no reads' : `${unobserved} unobserved`}, ${seconds}s${
        turnStats === undefined
          ? ''
          : `, turns solved ${turnStats.solved}, fallbacks ${JSON.stringify(turnStats.fallbacks)}`
      }\n`,
    )
  }
}
record.finish(hands - failed, failed + unobserved)
