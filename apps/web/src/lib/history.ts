import type { HandRecord, ReplayFrame, Street } from '@river/engine'
import { summariseHand } from '@river/engine'
import { formatAmount } from './presentation'

export type HandOutcome = 'won' | 'lost' | 'even' | 'away'

export interface HistoryRow {
  handNumber: number
  /** Chips the pot actually held, as the table counted it. */
  potChips: number
  street: Street
  showdown: boolean
  outcome: HandOutcome
  /** Signed, from this player's side. Zero when they were not dealt in. */
  deltaChips: number
  /** A hand can only be checked once its seed is revealed. */
  verifiable: boolean
}

/**
 * A settled hand, numbered by the session rather than by the table.
 *
 * A room counts its hands from one, and so does the next table - or the same
 * table once the server has restarted - so a session that sat at two tables
 * had two of every number. The panel read #2, #1, #2, #1, and opening one hand
 * opened its namesake with it. The session's own count gives every hand it has
 * seen a number nothing else shares.
 */
export interface SessionHand {
  /** One for the first hand this session saw settle, then one more for each after it. */
  sessionNumber: number
  record: HandRecord
}

/** A history row with the name the panel gives it, and the hand it replays. */
export interface SessionRow extends HistoryRow {
  label: string
  sessionNumber: number
  record: HandRecord
}

/** How many hands the panel keeps: the same number a table keeps for itself. */
export const SESSION_HAND_LIMIT = 24

const STREET_LABELS: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/**
 * Add hands that have just settled, newest first.
 *
 * Hands arrive in the order they settled, so the last of a batch is the
 * newest. Numbering carries on from the highest number given so far, which
 * stays in the list however many old hands have dropped off the end, so no
 * number is given twice.
 */
export function withSettledHands(
  hands: readonly SessionHand[],
  settled: readonly HandRecord[],
  limit: number = SESSION_HAND_LIMIT,
): readonly SessionHand[] {
  if (settled.length === 0) return hands
  const highest = hands.reduce((top, hand) => Math.max(top, hand.sessionNumber), 0)
  const numbered = settled.map((record, index) => ({ sessionNumber: highest + index + 1, record }))
  return [...numbered.reverse(), ...hands].slice(0, limit)
}

/** The session's hands as the panel lists them, in the order they are kept: newest first. */
export function sessionRows(
  hands: readonly SessionHand[],
  playerId: string,
): readonly SessionRow[] {
  return hands.map(({ sessionNumber, record }) => ({
    ...historyRow(record, playerId),
    label: `#${sessionNumber}`,
    sessionNumber,
    record,
  }))
}

/**
 * One row per hand, told from one player's side of the table.
 *
 * Seats are matched by player rather than by index, because a player who
 * stands up and sits back down keeps their history but not their seat. A hand
 * they were not dealt into still appears - the table played it, and a history
 * with holes in it is harder to trust than one that says "away".
 */
export function historyRows(
  records: readonly HandRecord[],
  playerId: string,
): readonly HistoryRow[] {
  return records.map((record) => historyRow(record, playerId))
}

function historyRow(record: HandRecord, playerId: string): HistoryRow {
  const summary = summariseHand(record)
  const seat = record.seats.find((entry) => entry.playerId === playerId)
  const result =
    seat === undefined ? undefined : record.results.find((entry) => entry.seat === seat.seat)
  const delta = result?.delta ?? 0
  return {
    handNumber: record.handNumber,
    potChips: summary.potSize,
    street: summary.finalStreet ?? 'preflop',
    showdown: summary.wentToShowdown,
    outcome: outcomeOf(seat === undefined, delta),
    deltaChips: delta,
    verifiable: record.revealedSeed !== null,
  }
}

function outcomeOf(away: boolean, delta: number): HandOutcome {
  if (away) return 'away'
  if (delta > 0) return 'won'
  if (delta < 0) return 'lost'
  return 'even'
}

/**
 * What the row says about the player's night.
 *
 * A losing hand reads as a loss rather than a negative number, because a
 * minus sign in front of a chip count is easy to misread at a glance and this
 * column is scanned, not studied.
 */
export function outcomeLabel(row: HistoryRow, bigBlind: number | null = null): string {
  switch (row.outcome) {
    case 'won':
      return `Won ${formatAmount(row.deltaChips, false, bigBlind)}`
    case 'lost':
      return `Lost ${formatAmount(-row.deltaChips, false, bigBlind)}`
    case 'even':
      return 'Broke even'
    default:
      return 'Not dealt in'
  }
}

/**
 * What a step of a replay says, with its amount in the player's units.
 *
 * The engine words every step, and writes the amount into two of them - a
 * raise, and the pot once it settles - in chips. Those two are worded here
 * from the step's own figures so they follow the big-blind setting. Steps are
 * the deal, then one per action in order, then the settle, which is how the
 * engine builds them; every other step keeps the engine's words.
 */
export function replayStepLabel(
  record: HandRecord,
  frame: ReplayFrame,
  bigBlind: number | null,
): string {
  if (frame.index === record.actions.length + 1) {
    return `Pot settled at ${formatAmount(frame.potAfter, false, bigBlind)}`
  }
  const step = frame.index > 0 ? record.actions[frame.index - 1] : undefined
  if (step?.action.kind === 'raiseTo') {
    return `Seat ${step.seat} raises to ${formatAmount(step.action.to, false, bigBlind)}`
  }
  return frame.label
}

export function streetLabel(street: Street): string {
  return STREET_LABELS[street]
}

/** Net chips across the hands on screen. The session line, not lifetime. */
export function netChips(rows: readonly HistoryRow[]): number {
  return rows.reduce((total, row) => total + row.deltaChips, 0)
}

/** Hands this player was actually dealt into. */
export function handsPlayed(rows: readonly HistoryRow[]): number {
  return rows.filter((row) => row.outcome !== 'away').length
}

/**
 * Share of dealt-in hands that reached a showdown, as a whole percent.
 *
 * Returns null rather than zero when nothing has been played, because zero is
 * a real statistic and "no hands yet" is not.
 */
export function showdownPercent(rows: readonly HistoryRow[]): number | null {
  const played = rows.filter((row) => row.outcome !== 'away')
  if (played.length === 0) return null
  return Math.round((played.filter((row) => row.showdown).length / played.length) * 100)
}
