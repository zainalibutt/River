import { readFileSync } from 'node:fs'
import { parseCard } from '@river/engine'
import { allInEquityChips } from './bot-allin-equity.js'
import { botPlayerId } from './bot-service.js'
import { clusteredEstimate } from './bot-session-evaluation.js'
import { SLUMBOT_STAKE, slumbotMoves, slumbotRoom } from './bot-slumbot.js'

// Usage: tsx bot-slumbot-pool.ts <hands.jsonl> [more.jsonl ...]
// What a focal policy won from Slumbot, raw and with all-ins before the river
// valued at their showdown share. Every hand is also replayed at a River table
// with both players' real cards, and River must pay the chips Slumbot paid.
interface LoggedHand {
  readonly hand: number
  readonly focal: string
  readonly clientPos: 0 | 1
  readonly hole: readonly string[]
  readonly slumbotHole: readonly string[] | null
  readonly board: readonly string[]
  readonly action: string
  readonly winnings: number
}

const files = process.argv.slice(2)
if (files.length === 0) throw new Error('usage: <hands.jsonl> [more.jsonl ...]')
const hands = files.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LoggedHand),
)
const ids = { ours: botPlayerId('river'), theirs: botPlayerId('slumbot') }
const stack = SLUMBOT_STAKE.defaultBuyIn
const cardsBefore = [0, 3, 4, 5]
let disagreements = 0
let unreplayable = 0
let allIns = 0

/** Chips won, with an all-in before the river valued at our showdown share. */
function allInValue(hand: LoggedHand, index: number): number {
  const last = slumbotMoves(hand.action).at(-1)
  if (hand.slumbotHole === null || last === undefined || last.action.kind === 'fold') {
    return hand.winnings
  }
  if (last.street >= 3) return hand.winnings
  allIns += 1
  // Stacks are equal and reset every hand, so a called all-in stakes both whole stacks.
  const value = allInEquityChips(
    [
      { playerId: 'ours', contributed: stack, contending: true },
      { playerId: 'theirs', contributed: stack, contending: true },
    ],
    new Map([
      ['ours', hand.hole.map(parseCard)],
      ['theirs', hand.slumbotHole.map(parseCard)],
    ]),
    hand.board.slice(0, cardsBefore[last.street]).map(parseCard),
    'ours',
    hand.winnings,
    `slumbot:${index}`,
  )
  return value ?? hand.winnings
}

const raw: { session: number; value: number }[] = []
const valued: { session: number; value: number }[] = []
hands.forEach((hand, index) => {
  try {
    const room = slumbotRoom(
      {
        action: hand.action,
        clientPos: hand.clientPos,
        hole: hand.hole.map(parseCard),
        board: hand.board.map(parseCard),
        ...(hand.slumbotHole === null ? {} : { theirHole: hand.slumbotHole.map(parseCard) }),
      },
      ids,
    )
    const view = room.viewFor('')
    const ours = view.seats.find((seat) => seat.playerId === ids.ours)
    if (view.phase !== 'between' || ours === undefined || ours.stack - stack !== hand.winnings) {
      disagreements += 1
    }
  } catch {
    unreplayable += 1
  }
  raw.push({ session: index, value: hand.winnings })
  valued.push({ session: index, value: allInValue(hand, index) })
})

const describe = (rows: { session: number; value: number }[]) => {
  const estimate = clusteredEstimate(rows, rows.length, SLUMBOT_STAKE.bigBlind)
  const [low, high] = estimate.interval95
  return `${estimate.bigBlindsPer100.toFixed(1)} (${low.toFixed(1)} to ${high.toFixed(1)}) bb/100`
}
const reindex = (rows: { session: number; value: number }[]) =>
  rows.map((row, index) => ({ session: index, value: row.value }))
const onButton = (rows: { session: number; value: number }[], position: 0 | 1) =>
  reindex(rows.filter((_, index) => hands[index]?.clientPos === position))

process.stdout.write(
  `${hands.length} hands against Slumbot; River disagreed with Slumbot's payout on ${disagreements} and could not replay ${unreplayable}\n`,
)
process.stdout.write(`raw: ${describe(raw)}\n`)
process.stdout.write(`all-in valued (${allIns} all-ins before the river): ${describe(valued)}\n`)
process.stdout.write(
  `valued minus raw: ${describe(valued.map((row, index) => ({ session: index, value: row.value - (raw[index]?.value ?? 0) })))}\n`,
)
process.stdout.write(
  `on the button: ${describe(onButton(valued, 1))}; in the big blind: ${describe(onButton(valued, 0))}\n`,
)
