import { appendFileSync, readFileSync } from 'node:fs'
import {
  type BotPersonality,
  championPersonality,
  mulberry32,
  parseCard,
  seedFromString,
} from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { botPlayerId } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { type SlumbotState, slumbotIncrement, slumbotMemory, slumbotRoom } from './bot-slumbot.js'

// Usage: tsx bot-slumbot-reads-probe.ts <hands.jsonl> <run seed> <first hand> <end hand> <out.jsonl>
//
// Replays a v8z run against Slumbot that played with reads, decision by
// decision, in the order it was played. At each of our decisions it asks the
// policy again, with the memory the run had and the same random draws, and
// checks the answer is the move the run sent; a replay that cannot reproduce
// the run proves nothing. It then asks a second copy of the policy what it
// would have done with no memory of Slumbot, handing it the same random draws,
// so the two answers differ only by what the memory told it. One line per
// decision goes to the output.
//
// Hands before <first hand> are only remembered, not decided, so the range can
// be split across processes. The solver's caches are decision-identical, so a
// fresh cache in each process changes nothing.
const [file, runSeed, firstText, endText, out] = process.argv.slice(2)
const first = Number(firstText)
const end = Number(endText)
if (!file || !runSeed || !out || !Number.isSafeInteger(first) || !Number.isSafeInteger(end)) {
  throw new Error('usage: <hands.jsonl> <run seed> <first hand> <end hand> <out.jsonl>')
}

interface LoggedHand {
  readonly hand: number
  readonly personality: string
  readonly clientPos: 0 | 1
  readonly hole: readonly string[]
  readonly slumbotHole: readonly string[] | null
  readonly board: readonly string[]
  readonly action: string
  readonly winnings: number
}

const hands = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as LoggedHand)

const cast = new Map<string, BotPersonality>(
  [championPersonality(), ...focalRotation()].map((personality) => [personality.id, personality]),
)
const withMemory = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
const withoutMemory = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
const memory = slumbotMemory()
const cardsDealt = [0, 3, 4, 5]

/** Each move in a Slumbot action string, and where it starts. */
function moves(action: string): { start: number; text: string }[] {
  const found: { start: number; text: string }[] = []
  let index = 0
  while (index < action.length) {
    const code = action[index]
    if (code === '/') {
      index += 1
    } else if (code === 'k' || code === 'c' || code === 'f') {
      found.push({ start: index, text: code })
      index += 1
    } else if (code === 'b') {
      let stop = index + 1
      while (stop < action.length && /[0-9]/.test(action[stop] as string)) stop += 1
      found.push({ start: index, text: action.slice(index, stop) })
      index = stop
    } else {
      throw new Error(`unknown Slumbot action ${code} in ${action}`)
    }
  }
  return found
}

function finished(hand: LoggedHand): SlumbotState {
  return {
    action: hand.action,
    clientPos: hand.clientPos,
    hole: hand.hole.map(parseCard),
    board: hand.board.map(parseCard),
    ...(hand.slumbotHole === null ? {} : { theirHole: hand.slumbotHole.map(parseCard) }),
  }
}

let decisions = 0
let reproduced = 0
for (const hand of hands) {
  const personality = cast.get(hand.personality)
  if (personality === undefined) throw new Error(`unknown personality ${hand.personality}`)
  const ours = botPlayerId(personality.id)
  if (hand.hand >= first && hand.hand < end) {
    const rng = mulberry32(seedFromString(`slumbot:${runSeed}:${hand.hand}`))
    const remembered = memory.options()
    moves(hand.action).forEach((move, index) => {
      const prefix = hand.action.slice(0, move.start)
      const street = (prefix.match(/\//g) ?? []).length
      const state: SlumbotState = {
        action: prefix,
        clientPos: hand.clientPos,
        hole: hand.hole.map(parseCard),
        board: hand.board.slice(0, cardsDealt[street]).map(parseCard),
      }
      const view = slumbotRoom(state, { ours, theirs: botPlayerId('slumbot') }).viewFor(ours)
      if (view.currentActor?.playerId !== ours) return
      const draws: number[] = []
      const recorded = () => {
        const value = rng()
        draws.push(value)
        return value
      }
      const actual = slumbotIncrement(state, withMemory.policy, personality, recorded, remembered)
      const fallback = mulberry32(seedFromString(`probe:${runSeed}:${hand.hand}:${index}`))
      let replayed = 0
      const same = () => (replayed < draws.length ? (draws[replayed++] as number) : fallback())
      const alternative = slumbotIncrement(state, withoutMemory.policy, personality, same, {})
      decisions += 1
      if (actual === move.text) reproduced += 1
      const seat = view.seats.find((entry) => entry.playerId === ours)
      appendFileSync(
        out,
        `${JSON.stringify({
          hand: hand.hand,
          street,
          seat: hand.clientPos === 0 ? 'big-blind' : 'button',
          logged: move.text,
          actual,
          withoutMemory: alternative,
          committed: seat?.betHand ?? null,
          winnings: hand.winnings,
        })}\n`,
      )
    })
  }
  memory.observe(finished(hand), ours, hand.hand)
  if (hand.hand + 1 >= end) break
}
process.stderr.write(
  `hands ${first} to ${end}: ${decisions} decisions, ${reproduced} reproduced the run, ${decisions - reproduced} did not\n`,
)
