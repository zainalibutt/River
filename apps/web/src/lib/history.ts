import type { HandRecord, Street } from '@river/engine'
import { summariseHand } from '@river/engine'

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

const STREET_LABELS: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
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
  return records.map((record) => {
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
  })
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
export function outcomeLabel(row: HistoryRow): string {
  switch (row.outcome) {
    case 'won':
      return `Won ${formatChips(row.deltaChips)}`
    case 'lost':
      return `Lost ${formatChips(-row.deltaChips)}`
    case 'even':
      return 'Broke even'
    default:
      return 'Not dealt in'
  }
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

export function formatChips(amount: number): string {
  return Math.trunc(amount).toLocaleString('en-GB')
}
