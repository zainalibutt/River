import type { Card, HandRecord } from '@river/engine'

/**
 * Each person's private record of the hands they played (table public.player_hands).
 *
 * One row per seated person per settled hand, written with the service role; a player reads
 * their own rows through row-level security and nobody else's. A row carries the hand as the
 * table broadcast it, which has no hole cards, and that player's own two cards only.
 */

export interface PlayerHandRow {
  playerId: string
  /** Unique per hand: the room, the hand number and its fairness commit. */
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

export interface PlayerHandStore {
  append(rows: readonly PlayerHandRow[]): Promise<void>
}

/**
 * The rows a settled hand gives its people. Bots keep no record; a seat's net result and
 * whether it showed come from the record itself, and its own cards from what that player
 * was shown.
 */
export function playerHandRows(input: {
  roomId: string
  record: HandRecord
  playedAtMs: number
  roomKind: 'bots' | 'private'
  isBot: (playerId: string) => boolean
  nameOf: (playerId: string) => string
  ownHoleOf: (playerId: string) => readonly Card[] | null
}): PlayerHandRow[] {
  const { record } = input
  const handId = `${input.roomId}:${record.handNumber}:${record.commit}`
  return record.seats.flatMap((seat) => {
    if (input.isBot(seat.playerId)) return []
    const result = record.results.find((entry) => entry.seat === seat.seat)
    return [
      {
        playerId: seat.playerId,
        handId,
        playedAtMs: input.playedAtMs,
        roomKind: input.roomKind,
        bigBlind: record.stake.bigBlind,
        netChips: result?.delta ?? 0,
        showed: result?.showed ?? false,
        record,
        ownHole: input.ownHoleOf(seat.playerId),
        opponents: record.seats
          .filter((other) => other.playerId !== seat.playerId)
          .map((other) => input.nameOf(other.playerId)),
      },
    ]
  })
}

export interface SupabasePlayerHandStoreOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export class SupabasePlayerHandStore implements PlayerHandStore {
  private readonly url: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SupabasePlayerHandStoreOptions) {
    this.url = `${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/player_hands`
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 4_000
  }

  async append(rows: readonly PlayerHandRow[]): Promise<void> {
    if (rows.length === 0) return
    const response = await this.request(this.url, {
      method: 'POST',
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
        // A hand written twice, by a retry, is the same hand.
        prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify(
        rows.map((row) => ({
          player_id: row.playerId,
          hand_id: row.handId,
          played_at: new Date(row.playedAtMs).toISOString(),
          room_kind: row.roomKind,
          big_blind: row.bigBlind,
          net_chips: row.netChips,
          showed: row.showed,
          record: row.record,
          own_hole: row.ownHole,
          opponents: row.opponents,
        })),
      ),
    })
    if (!response.ok) {
      throw new Error(`player hands write failed with ${response.status}`)
    }
  }
}
