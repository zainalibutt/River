import { describe, expect, it } from 'vitest'
import type { SeatPinInput } from './seat-pin.js'
import { seatPin } from './seat-pin.js'
import type { SeatMood } from './seat-presentation.js'
import type { TurnClock } from './turn-clock.js'

function clock(fraction: number, urgent = false): TurnClock {
  return {
    phase: fraction <= 0 ? 'expired' : urgent ? 'urgent' : 'running',
    remainingMs: 0,
    fraction,
    handDegrees: 360 * (1 - fraction),
    urgent,
  }
}

function input(overrides: Partial<SeatPinInput>): SeatPinInput {
  return { mood: 'waiting', committed: 0, isActing: false, clock: null, ...overrides }
}

describe('seatPin', () => {
  it('shows nothing for a waiting seat with no bet', () => {
    expect(seatPin(input({}))).toEqual({
      kind: 'none',
      glyph: null,
      amount: null,
      fraction: null,
      urgent: false,
    })
  })

  it('shows the clock for the acting seat, exclusively', () => {
    const pin = seatPin(input({ isActing: true, mood: 'away', committed: 500, clock: clock(0.6) }))
    expect(pin.kind).toBe('clock')
    expect(pin.glyph).toBeNull()
    expect(pin.amount).toBeNull()
    expect(pin.fraction).toBe(0.6)
    expect(pin.urgent).toBe(false)
  })

  it('carries urgency through only for the clock', () => {
    const pin = seatPin(input({ isActing: true, clock: clock(0.2, true) }))
    expect(pin.kind).toBe('clock')
    expect(pin.urgent).toBe(true)
  })

  it('shows the amount for a seat with chips committed, beating a glyph', () => {
    const pin = seatPin(input({ mood: 'folded', committed: 1200 }))
    expect(pin.kind).toBe('amount')
    expect(pin.amount).toBe(1200)
    expect(pin.glyph).toBeNull()
    expect(pin.urgent).toBe(false)
  })

  it('treats a committed zero as not a bet and falls through to the glyph', () => {
    const pin = seatPin(input({ mood: 'folded', committed: 0 }))
    expect(pin.kind).toBe('glyph')
    expect(pin.glyph).toBe('fold')
    expect(pin.amount).toBeNull()
  })

  it('maps a folded mood to a fold glyph', () => {
    expect(seatPin(input({ mood: 'folded' })).glyph).toBe('fold')
  })

  it('maps away and sitting out moods to their glyphs', () => {
    expect(seatPin(input({ mood: 'away' })).glyph).toBe('away')
    expect(seatPin(input({ mood: 'sittingOut' })).glyph).toBe('sittingOut')
  })

  it('maps an all-in mood to a check glyph', () => {
    expect(seatPin(input({ mood: 'allIn' })).glyph).toBe('check')
  })

  it('does not mark dealt, waiting, won, busy or busted as a standalone glyph', () => {
    for (const mood of ['dealt', 'waiting', 'empty'] as SeatMood[]) {
      expect(seatPin(input({ mood })).kind).toBe('none')
    }
  })

  it('keeps exactly one thing above a seat that acts, has bet and is marked away', () => {
    const pin = seatPin(input({ isActing: true, mood: 'away', committed: 500, clock: clock(0.5) }))
    expect(pin.kind).toBe('clock')
    expect(pin.glyph).toBeNull()
    expect(pin.amount).toBeNull()
  })

  it('shows nothing for an acting seat with no clock resolved', () => {
    expect(seatPin(input({ isActing: true, clock: null })).kind).toBe('none')
  })

  it('shows nothing for six seats out of nine with one actor and two bettors', () => {
    const actors = input({ isActing: true, clock: clock(0.8) })
    const bettors = [input({ committed: 400 }), input({ committed: 400 })]
    const quiet = Array.from({ length: 6 }, () => input({}))
    const seats = [actors, ...bettors, ...quiet]
    const kinds = seats.map((seat) => seatPin(seat).kind)
    expect(kinds.filter((kind) => kind === 'none')).toHaveLength(6)
    expect(kinds.filter((kind) => kind === 'clock')).toHaveLength(1)
    expect(kinds.filter((kind) => kind === 'amount')).toHaveLength(2)
  })

  it('is deterministic for identical input', () => {
    const a = seatPin(input({ isActing: true, clock: clock(0.4) }))
    const b = seatPin(input({ isActing: true, clock: clock(0.4) }))
    expect(b).toEqual(a)
  })
})
