/**
 * The limits on friend requests, as pure rules the server route applies.
 *
 * Friends are the first thing in River that lets one player reach another, so asking is
 * bounded: a handful of open requests, a few new ones a day, requests that lapse, and a
 * pause before asking again somebody who said no. A block is silent: the blocked player is
 * told nothing, and their requests and invitations simply never arrive.
 */

export const MAX_PENDING_OUT = 20
export const MAX_REQUESTS_PER_DAY = 10
export const REQUEST_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000
export const RESEND_AFTER_DECLINE_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export type RequestRefusal =
  | 'self'
  | 'already-friends'
  | 'already-asked'
  | 'too-many-pending'
  | 'too-many-today'
  | 'declined-recently'

/** What to do with a new request: send it, drop it silently because of a block, or refuse. */
export type RequestDecision =
  | { kind: 'send' }
  | { kind: 'silent' }
  | { kind: 'refuse'; reason: RequestRefusal }

export interface RequestContext {
  fromId: string
  toId: string
  nowMs: number
  alreadyFriends: boolean
  /** Either has blocked the other. */
  blocked: boolean
  /** A pending, unexpired request between the two already exists, either way round. */
  openBetween: boolean
  /** The sender's own requests, as created times and statuses. */
  sent: readonly {
    createdAtMs: number
    status: string
    toId: string
    respondedAtMs: number | null
  }[]
}

export function isLive(createdAtMs: number, nowMs: number): boolean {
  return nowMs - createdAtMs < REQUEST_EXPIRY_MS
}

export function decideRequest(context: RequestContext): RequestDecision {
  if (context.fromId === context.toId) return { kind: 'refuse', reason: 'self' }
  if (context.alreadyFriends) return { kind: 'refuse', reason: 'already-friends' }
  if (context.openBetween) return { kind: 'refuse', reason: 'already-asked' }
  const pending = context.sent.filter(
    (request) => request.status === 'pending' && isLive(request.createdAtMs, context.nowMs),
  )
  if (pending.length >= MAX_PENDING_OUT) return { kind: 'refuse', reason: 'too-many-pending' }
  const today = context.sent.filter((request) => context.nowMs - request.createdAtMs < DAY_MS)
  if (today.length >= MAX_REQUESTS_PER_DAY) return { kind: 'refuse', reason: 'too-many-today' }
  const declined = context.sent.some(
    (request) =>
      request.toId === context.toId &&
      request.status === 'declined' &&
      request.respondedAtMs !== null &&
      context.nowMs - request.respondedAtMs < RESEND_AFTER_DECLINE_MS,
  )
  if (declined) return { kind: 'refuse', reason: 'declined-recently' }
  // Blocked either way: the sender sees it sent, and nothing reaches the other player.
  if (context.blocked) return { kind: 'silent' }
  return { kind: 'send' }
}

/** What a refusal says to the player who asked. */
export function refusalCopy(reason: RequestRefusal): string {
  switch (reason) {
    case 'self':
      return 'That is your own name.'
    case 'already-friends':
      return 'You are already friends.'
    case 'already-asked':
      return 'There is already a request between you.'
    case 'too-many-pending':
      return 'You have 20 requests waiting. Let some be answered first.'
    case 'too-many-today':
      return 'You have sent 10 requests today. Try again tomorrow.'
    case 'declined-recently':
      return 'They said no recently. You can ask again in a week.'
  }
}

/** A friendship row keeps its two players in order, so a pair is one row. */
export function friendPair(a: string, b: string): { player_a: string; player_b: string } {
  return a < b ? { player_a: a, player_b: b } : { player_a: b, player_b: a }
}
