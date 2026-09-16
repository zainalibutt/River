import type { RoomView } from '@river/server'

/**
 * A change to your own seat.
 *
 * The room takes these only between hands, and between hands lasts three
 * seconds. Offering them only in that gap made a player catch it, so one asked
 * for during a hand waits and is sent in the next gap.
 */
export type SeatRequest = { kind: 'leave' } | { kind: 'stand' } | { kind: 'rebuy'; amount: number }

/** A request waiting for the gap, or sent and waiting for the server. */
export interface PendingSeatRequest {
  request: SeatRequest
  requestId: string | null
  /** Refusals so far. */
  attempts: number
}

/**
 * How many times a refused request goes back to wait for another gap. A request
 * sent late in a gap reaches the server after the next hand has started, which
 * a slow machine or a tab in the background makes likely rather than rare.
 */
export const SEAT_REQUEST_ATTEMPTS = 3

/** Whether the room will take a seat change now. */
export function seatChangeOpen(phase: RoomView['phase']): boolean {
  return phase !== 'hand' && phase !== 'seeding'
}

/**
 * Pressing the waiting request again withdraws it, and a different one replaces
 * it. A request already sent stays until the server answers, because the
 * answer is what moves the player on.
 */
export function toggleSeatRequest(
  current: PendingSeatRequest | null,
  request: SeatRequest,
): PendingSeatRequest | null {
  if (current === null) return { request, requestId: null, attempts: 0 }
  if (current.requestId !== null) return current
  if (current.request.kind === request.kind) return null
  return { request, requestId: null, attempts: 0 }
}

/** A refused request waits for the next gap, until it has been refused enough. */
export function requeueSeatRequest(refused: PendingSeatRequest): PendingSeatRequest | null {
  const attempts = refused.attempts + 1
  if (attempts >= SEAT_REQUEST_ATTEMPTS) return null
  return { request: refused.request, requestId: null, attempts }
}
