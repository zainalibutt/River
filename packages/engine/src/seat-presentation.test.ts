import { describe, expect, it } from 'vitest'
import type { SeatFacts, SeatMood } from './seat-presentation.js'
import { moodPriority, seatIsInteractive, seatMood } from './seat-presentation.js'

const ALL_MOODS: readonly SeatMood[] = [
  'empty',
  'waiting',
  'dealt',
  'acting',
  'folded',
  'allIn',
  'won',
  'busted',
  'away',
  'sittingOut',
]

const BOOLEAN_FIELDS: readonly (keyof SeatFacts)[] = [
  'occupied',
  'hasHole',
  'folded',
  'allIn',
  'busted',
  'sittingOut',
  'disconnected',
  'isActor',
  'wonLastHand',
  'handLive',
]

function facts(mask: number, stack: number): SeatFacts {
  let bits = mask
  const result: Record<string, boolean | number> = { stack }
  for (const field of BOOLEAN_FIELDS) {
    result[field] = (bits & 1) === 1
    bits = bits >>> 1
  }
  return result as unknown as SeatFacts
}

describe('seatMood exhaustiveness', () => {
  it('returns a valid mood for every combination of facts and two stack values', () => {
    for (let mask = 0; mask < 1 << BOOLEAN_FIELDS.length; mask += 1) {
      for (const stack of [0, 50_000]) {
        const mood = seatMood(facts(mask, stack))
        expect(ALL_MOODS).toContain(mood)
      }
    }
  })

  it('reports an unoccupied seat as empty even when every other flag is set', () => {
    const flagged: SeatFacts = {
      occupied: false,
      stack: 50_000,
      hasHole: true,
      folded: true,
      allIn: true,
      busted: true,
      sittingOut: true,
      disconnected: true,
      isActor: true,
      wonLastHand: true,
      handLive: true,
    }
    expect(seatMood(flagged)).toBe('empty')
  })

  it('never reports an acting player as folded', () => {
    const mood = seatMood({
      occupied: true,
      stack: 50_000,
      hasHole: true,
      folded: true,
      allIn: false,
      busted: false,
      sittingOut: false,
      disconnected: false,
      isActor: true,
      wonLastHand: false,
      handLive: true,
    })
    expect(mood).toBe('acting')
  })

  it('never reports a busted player as empty or waiting', () => {
    const mood = seatMood({
      occupied: true,
      stack: 0,
      hasHole: false,
      folded: false,
      allIn: false,
      busted: true,
      sittingOut: false,
      disconnected: false,
      isActor: false,
      wonLastHand: false,
      handLive: false,
    })
    expect(mood).toBe('busted')
  })

  it('respects precedence when allIn and isActor both apply', () => {
    const mood = seatMood({
      occupied: true,
      stack: 50_000,
      hasHole: true,
      folded: false,
      allIn: true,
      busted: false,
      sittingOut: false,
      disconnected: false,
      isActor: true,
      wonLastHand: false,
      handLive: true,
    })
    expect(mood).toBe('allIn')
  })

  it('prefers waiting over empty for an occupied seat with no live state', () => {
    const mood = seatMood({ ...emptyFacts(), occupied: true, stack: 50_000 })
    expect(mood).toBe('waiting')
  })
})

describe('moodPriority', () => {
  it('lists every seat mood exactly once', () => {
    const order = moodPriority()
    expect(new Set(order).size).toBe(order.length)
    expect(order.length).toBe(ALL_MOODS.length)
    for (const mood of ALL_MOODS) {
      expect(order).toContain(mood)
    }
  })

  it('orders urgent and live states before stale ones', () => {
    const order = moodPriority()
    expect(order.indexOf('acting')).toBeLessThan(order.indexOf('folded'))
    expect(order.indexOf('busted')).toBeLessThan(order.indexOf('empty'))
    expect(order.indexOf('busted')).toBeLessThan(order.indexOf('waiting'))
  })
})

describe('seatIsInteractive', () => {
  it('is false for an occupied seat', () => {
    expect(seatIsInteractive({ ...emptyFacts(), occupied: true })).toBe(false)
  })

  it('is true for an unoccupied seat', () => {
    expect(seatIsInteractive(emptyFacts())).toBe(true)
  })
})

function emptyFacts(): SeatFacts {
  return {
    occupied: false,
    stack: 0,
    hasHole: false,
    folded: false,
    allIn: false,
    busted: false,
    sittingOut: false,
    disconnected: false,
    isActor: false,
    wonLastHand: false,
    handLive: false,
  }
}
