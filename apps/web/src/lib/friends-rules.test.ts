import { describe, expect, it } from 'vitest'
import {
  decideRequest,
  friendPair,
  MAX_PENDING_OUT,
  MAX_REQUESTS_PER_DAY,
  REQUEST_EXPIRY_MS,
  RESEND_AFTER_DECLINE_MS,
  type RequestContext,
} from './friends-rules'

const NOW = 100 * 24 * 60 * 60 * 1000

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    fromId: 'a',
    toId: 'b',
    nowMs: NOW,
    alreadyFriends: false,
    blocked: false,
    openBetween: false,
    sent: [],
    ...overrides,
  }
}

const sentAt = (
  ageMs: number,
  status = 'pending',
  toId = 'x',
  respondedAgoMs: number | null = null,
) => ({
  createdAtMs: NOW - ageMs,
  status,
  toId,
  respondedAtMs: respondedAgoMs === null ? null : NOW - respondedAgoMs,
})

describe('friend requests', () => {
  it('sends an ordinary request and refuses the obvious ones', () => {
    expect(decideRequest(context())).toEqual({ kind: 'send' })
    expect(decideRequest(context({ toId: 'a' }))).toEqual({ kind: 'refuse', reason: 'self' })
    expect(decideRequest(context({ alreadyFriends: true })).kind).toBe('refuse')
    expect(decideRequest(context({ openBetween: true })).kind).toBe('refuse')
  })

  it('keeps open requests and new ones a day within bounds, and lets old ones lapse', () => {
    const old = Array.from({ length: MAX_PENDING_OUT }, () => sentAt(2 * 24 * 3_600_000))
    expect(decideRequest(context({ sent: old }))).toEqual({
      kind: 'refuse',
      reason: 'too-many-pending',
    })
    const lapsed = Array.from({ length: MAX_PENDING_OUT }, () => sentAt(REQUEST_EXPIRY_MS + 1))
    expect(decideRequest(context({ sent: lapsed }))).toEqual({ kind: 'send' })
    const today = Array.from({ length: MAX_REQUESTS_PER_DAY }, () => sentAt(60_000, 'cancelled'))
    expect(decideRequest(context({ sent: today }))).toEqual({
      kind: 'refuse',
      reason: 'too-many-today',
    })
  })

  it('waits a week before asking again somebody who said no', () => {
    const declined = [sentAt(10 * 24 * 3_600_000, 'declined', 'b', 2 * 24 * 3_600_000)]
    expect(decideRequest(context({ sent: declined }))).toEqual({
      kind: 'refuse',
      reason: 'declined-recently',
    })
    const longAgo = [sentAt(30 * 24 * 3_600_000, 'declined', 'b', RESEND_AFTER_DECLINE_MS + 1)]
    expect(decideRequest(context({ sent: longAgo }))).toEqual({ kind: 'send' })
  })

  it('drops a request across a block without telling the sender', () => {
    expect(decideRequest(context({ blocked: true }))).toEqual({ kind: 'silent' })
  })

  it('stores a friendship once, whichever way round', () => {
    expect(friendPair('b', 'a')).toEqual(friendPair('a', 'b'))
  })
})
