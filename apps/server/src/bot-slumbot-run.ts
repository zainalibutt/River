import { appendFileSync } from 'node:fs'
import { type BotPolicy, mulberry32, parseCard, seedFromString } from '@river/engine'
import { pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import { focalRotation } from './bot-session-campaign.js'
import { slumbotIncrement } from './bot-slumbot.js'

// Usage: tsx bot-slumbot-run.ts <v5|v6> <hands> <run seed> <out.jsonl>
// Plays hands against Slumbot's public heads-up API, one at a time, sending
// only our own moves; Slumbot deals and reports our cards. Each finished hand
// is appended to the output file as one JSON line.
const [focalName, handText, runSeed, out] = process.argv.slice(2)
const hands = Number(handText)
const policies: Record<string, BotPolicy> = { v5: v5GuardPolicy, v6: pokerGuardPolicy }
const policy = policies[focalName ?? '']
if (policy === undefined || !Number.isSafeInteger(hands) || hands < 1 || !runSeed || !out) {
  throw new Error('usage: <v5|v6> <hands> <run seed> <out.jsonl>')
}

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

const rotation = focalRotation()
let token: string | undefined
let total = 0
const started = Date.now()
for (let hand = 0; hand < hands; hand += 1) {
  const personality = rotation[hand % rotation.length]
  if (personality === undefined) throw new Error('no OG personality')
  const rng = mulberry32(seedFromString(`slumbot:${runSeed}:${hand}`))
  let state = await post('new_hand', token === undefined ? {} : { token })
  token = state.token ?? token
  for (let step = 0; state.winnings === undefined; step += 1) {
    if (step > 40) throw new Error(`hand ${hand} did not finish: ${state.action}`)
    const incr = slumbotIncrement(
      {
        action: state.action,
        clientPos: state.client_pos,
        hole: state.hole_cards.map(parseCard),
        board: state.board.map(parseCard),
      },
      policy,
      personality,
      rng,
    )
    state = await post('act', { token, incr })
    token = state.token ?? token
  }
  total += state.winnings
  appendFileSync(
    out,
    `${JSON.stringify({
      hand,
      focal: focalName,
      personality: personality.id,
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
      `${focalName}: ${hand + 1}/${hands} hands, ${((total / 100 / (hand + 1)) * 100).toFixed(1)} bb/100 so far, ${seconds}s\n`,
    )
  }
}
