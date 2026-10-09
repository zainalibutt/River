import type { Card, HandRecord } from '@river/engine'

/**
 * A player's private record, worked out from their rows in player_hands.
 *
 * Plain numbers with the sample beside each one: nothing here is a judgement, and a short
 * record is shown as short rather than dressed up as a trend.
 */

export interface RecordedHand {
  handId: string
  playedAtMs: number
  roomKind: 'bots' | 'private'
  bigBlind: number
  netChips: number
  showed: boolean
  record: HandRecord
  ownHole: readonly Card[] | null
  opponents: readonly string[]
}

export interface Scorecard {
  hands: number
  /** Net result in big blinds, each hand at its own stake. */
  netBigBlinds: number
  showdowns: number
  showdownsWon: number
}

export interface RecordSession {
  startedAtMs: number
  endedAtMs: number
  hands: number
  netBigBlinds: number
}

/** A gap longer than this between two hands starts a new session. */
export const SESSION_GAP_MS = 30 * 60 * 1000

export function scorecard(hands: readonly RecordedHand[]): Scorecard {
  let netBigBlinds = 0
  let showdowns = 0
  let showdownsWon = 0
  for (const hand of hands) {
    netBigBlinds += hand.netChips / hand.bigBlind
    if (hand.showed) {
      showdowns += 1
      if (hand.netChips > 0) showdownsWon += 1
    }
  }
  return { hands: hands.length, netBigBlinds, showdowns, showdownsWon }
}

/** The hands played with the champion at the table. */
export function againstNell(hands: readonly RecordedHand[]): Scorecard {
  return scorecard(hands.filter((hand) => hand.opponents.includes('Nell')))
}

/** Hands grouped into sittings, newest first, split wherever play stopped for half an hour. */
export function sessions(hands: readonly RecordedHand[]): RecordSession[] {
  const ordered = [...hands].sort((a, b) => a.playedAtMs - b.playedAtMs)
  const out: RecordSession[] = []
  for (const hand of ordered) {
    const current = out.at(-1)
    if (current !== undefined && hand.playedAtMs - current.endedAtMs <= SESSION_GAP_MS) {
      current.endedAtMs = hand.playedAtMs
      current.hands += 1
      current.netBigBlinds += hand.netChips / hand.bigBlind
    } else {
      out.push({
        startedAtMs: hand.playedAtMs,
        endedAtMs: hand.playedAtMs,
        hands: 1,
        netBigBlinds: hand.netChips / hand.bigBlind,
      })
    }
  }
  return out.reverse()
}

/** A row as the database returns it, checked rather than trusted. */
export function recordedHandFrom(row: Record<string, unknown>): RecordedHand | null {
  const record = row.record as HandRecord | undefined
  if (typeof row.hand_id !== 'string' || record === undefined || typeof record !== 'object') {
    return null
  }
  const bigBlind = Number(row.big_blind)
  if (!Number.isFinite(bigBlind) || bigBlind <= 0) return null
  return {
    handId: row.hand_id,
    playedAtMs: Date.parse(String(row.played_at)),
    roomKind: row.room_kind === 'private' ? 'private' : 'bots',
    bigBlind,
    netChips: Number(row.net_chips ?? 0),
    showed: row.showed === true,
    record,
    ownHole: Array.isArray(row.own_hole) ? (row.own_hole as Card[]) : null,
    opponents: Array.isArray(row.opponents) ? row.opponents.map(String) : [],
  }
}
