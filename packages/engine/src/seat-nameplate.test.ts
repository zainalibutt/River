import { describe, expect, it } from 'vitest'
import { progressFor } from './rep-progression.js'
import type { NameplateInput } from './seat-nameplate.js'
import { nameplate, nameplates } from './seat-nameplate.js'

function seat(overrides: Partial<NameplateInput>): NameplateInput {
  return {
    seat: 1,
    playerId: 'p1',
    name: 'Alice',
    stack: 10_000,
    rep: 0,
    folded: false,
    sittingOut: false,
    disconnected: false,
    ...overrides,
  }
}

describe('nameplate', () => {
  it('returns null for a seat with no player', () => {
    expect(nameplate(seat({ playerId: null }))).toBeNull()
  })

  it('builds a row for an occupied seat', () => {
    const plate = nameplate(seat({ stack: 37_500 }))
    expect(plate?.seat).toBe(1)
    expect(plate?.name).toBe('Alice')
    expect(plate?.stack).toBe(37_500)
    expect(plate?.rank).toBe(progressFor(0).title)
    expect(plate?.rankIndex).toBe(progressFor(0).level)
    expect(plate?.note).toBeNull()
  })

  it('falls back a missing name to a stable seat label', () => {
    const plate = nameplate(seat({ name: null }))
    expect(plate?.name).toBe('Seat 1')
  })

  it('never falls back to an empty string', () => {
    const plate = nameplate(seat({ name: '' }))
    expect(plate?.name).toBe('Seat 1')
  })

  it('ranks track rep through the real progression, not a hardcoded string', () => {
    const low = nameplate(seat({ rep: 0 }))
    const high = nameplate(seat({ rep: 5000 }))
    expect(low?.rank).toBe(progressFor(0).title)
    expect(low?.rankIndex).toBe(progressFor(0).level)
    expect(high?.rank).toBe(progressFor(5000).title)
    expect(high?.rankIndex).toBe(progressFor(5000).level)
    expect(progressFor(5000).level).toBeGreaterThan(progressFor(0).level)
  })

  it('gives note reconnecting precedence over sitting out and folded', () => {
    const plate = nameplate(seat({ disconnected: true, sittingOut: true, folded: true }))
    expect(plate?.note).toBe('reconnecting')
  })

  it('gives sitting out precedence over folded', () => {
    expect(nameplate(seat({ sittingOut: true, folded: true }))?.note).toBe('sitting out')
  })

  it('marks a folded seat', () => {
    expect(nameplate(seat({ folded: true }))?.note).toBe('folded')
  })

  it('clamps a negative or non-finite stack to zero without throwing', () => {
    expect(nameplate(seat({ stack: -500 }))?.stack).toBe(0)
    expect(nameplate(seat({ stack: Number.NaN }))?.stack).toBe(0)
    expect(nameplate(seat({ stack: Number.POSITIVE_INFINITY }))?.stack).toBe(0)
  })

  it('rounds a fractional stack down to whole chips', () => {
    expect(nameplate(seat({ stack: 1234.7 }))?.stack).toBe(1234)
  })
})

describe('nameplates', () => {
  it('preserves seat order and drops empty seats', () => {
    const seats = [
      seat({ seat: 3, playerId: 'p3', name: 'Cara' }),
      seat({ seat: 0, playerId: null }),
      seat({ seat: 5, playerId: 'p5', name: 'Evan' }),
      seat({ seat: 1, playerId: 'p1', name: 'Alice' }),
    ]
    const rows = nameplates(seats)
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.seat)).toEqual([3, 5, 1])
  })

  it('returns three rows for a nine-seat table with three players, in seat order', () => {
    const seats: NameplateInput[] = Array.from({ length: 9 }, (_, seatNumber) =>
      seat({ seat: seatNumber, playerId: null }),
    )
    seats[1] = seat({ seat: 1, playerId: 'p2', name: 'Babs' })
    seats[4] = seat({ seat: 4, playerId: 'p5', name: 'Eve' })
    seats[7] = seat({ seat: 7, playerId: 'p8', name: 'Hal' })
    const rows = nameplates(seats)
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.seat)).toEqual([1, 4, 7])
  })

  it('is deterministic for identical input', () => {
    const seats = [seat({ playerId: 'p1' }), seat({ playerId: null })]
    const first = nameplates(seats)
    const second = nameplates(seats)
    expect(second).toEqual(first)
  })
})
