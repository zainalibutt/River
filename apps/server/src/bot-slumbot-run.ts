import { appendFileSync } from 'node:fs'
import {
  type BotPolicy,
  championPersonality,
  mulberry32,
  parseCard,
  seedFromString,
} from '@river/engine'
import { pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { botPlayerId } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { slumbotIncrement, slumbotMemory } from './bot-slumbot.js'

// Usage: tsx bot-slumbot-run.ts <v5|v6|v8z> <hands> <run seed> <out.jsonl> [rotation|champion] [reads]
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
// does in the session campaigns and at River's live tables.
const [focalName, handText, runSeed, out, castName = 'rotation', readsName] = process.argv.slice(2)
const hands = Number(handText)
const policies: Record<string, () => BotPolicy> = {
  v5: () => v5GuardPolicy,
  v6: () => pokerGuardPolicy,
  v8z: () => riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING).policy,
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
  throw new Error('usage: <v5|v6|v8z> <hands> <run seed> <out.jsonl> [rotation|champion] [reads]')
}
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

async function post(path: string, body: object): Promise<SlumbotResponse> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`https://slumbot.com/slumbot/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
      const parsed = (await response.json()) as SlumbotResponse
      if (parsed.error_msg !== undefined) throw new Error(`Slumbot: ${parsed.error_msg}`)
      return parsed
    } catch (error) {
      if (attempt >= 3 || String(error).includes('Slumbot:')) throw error
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
        remembered,
      )
      state = await post('act', { token, incr })
      token = state.token ?? token
    }
  } catch (error) {
    failed += 1
    appendFileSync(
      `${out}.errors.jsonl`,
      `${JSON.stringify({ hand, action: state?.action ?? null, clientPos: state?.client_pos ?? null, hole: state?.hole_cards ?? null, board: state?.board ?? null, incr, error: String(error) })}\n`,
    )
    continue
  }
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
    })}\n`,
  )
  if ((hand + 1) % 50 === 0 || hand + 1 === hands) {
    const seconds = Math.round((Date.now() - started) / 1000)
    process.stderr.write(
      `${focalName}: ${hand + 1}/${hands} hands, ${((total / 100 / (hand + 1 - failed)) * 100).toFixed(1)} bb/100 so far, ${failed} failed, ${memory === null ? 'no reads' : `${unobserved} unobserved`}, ${seconds}s\n`,
    )
  }
}
