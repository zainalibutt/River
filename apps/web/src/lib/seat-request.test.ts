import { describe, expect, it } from 'vitest'
import {
  requeueSeatRequest,
  SEAT_REQUEST_ATTEMPTS,
  seatChangeOpen,
  seatRequestOpen,
  toggleSeatRequest,
} from './seat-request'

describe('changes to your own seat', () => {
  it('reaches the room only between hands', () => {
    expect(seatChangeOpen('open')).toBe(true)
    expect(seatChangeOpen('between')).toBe(true)
    expect(seatChangeOpen('seeding')).toBe(false)
    expect(seatChangeOpen('hand')).toBe(false)
  })

  it('lets a leave through during a hand, while standing up and buying more wait', () => {
    for (const phase of ['open', 'seeding', 'hand', 'between'] as const) {
      expect(seatRequestOpen({ kind: 'leave' }, phase)).toBe(true)
    }
    expect(seatRequestOpen({ kind: 'stand' }, 'hand')).toBe(false)
    expect(seatRequestOpen({ kind: 'rebuy', amount: 60_000 }, 'seeding')).toBe(false)
    expect(seatRequestOpen({ kind: 'stand' }, 'between')).toBe(true)
  })

  it('waits for the gap when asked for during a hand', () => {
    expect(toggleSeatRequest(null, { kind: 'leave' })).toEqual({
      request: { kind: 'leave' },
      requestId: null,
      attempts: 0,
    })
  })

  it('withdraws a waiting request pressed a second time', () => {
    const waiting = toggleSeatRequest(null, { kind: 'stand' })
    expect(toggleSeatRequest(waiting, { kind: 'stand' })).toBeNull()
  })

  it('replaces a waiting request with a different one', () => {
    const waiting = toggleSeatRequest(null, { kind: 'rebuy', amount: 60_000 })
    expect(toggleSeatRequest(waiting, { kind: 'leave' })).toEqual({
      request: { kind: 'leave' },
      requestId: null,
      attempts: 0,
    })
  })

  it('keeps a request the server has not answered yet', () => {
    const sent = { request: { kind: 'leave' as const }, requestId: 'leave-1', attempts: 0 }
    expect(toggleSeatRequest(sent, { kind: 'leave' })).toBe(sent)
    expect(toggleSeatRequest(sent, { kind: 'stand' })).toBe(sent)
  })

  it('sends a refused request again in the next gap, a bounded number of times', () => {
    // Observed: a leave sent two seconds into a three-second gap reached the
    // server after the next hand had started and was refused as mid-hand.
    let pending = requeueSeatRequest({
      request: { kind: 'leave' },
      requestId: 'leave-1',
      attempts: 0,
    })
    expect(pending).toEqual({ request: { kind: 'leave' }, requestId: null, attempts: 1 })
    let refusals = 1
    while (pending !== null) {
      pending = requeueSeatRequest({ ...pending, requestId: `leave-${refusals + 1}` })
      refusals += 1
    }
    expect(refusals).toBe(SEAT_REQUEST_ATTEMPTS)
  })
})
