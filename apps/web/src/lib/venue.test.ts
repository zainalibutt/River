import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VENUE,
  isVenueId,
  VENUE_ORDER,
  VENUES,
  venueFromParams,
  venueOf,
  worldSeats,
} from './venue.js'

describe('venue registry', () => {
  it('lists every venue exactly once, in order', () => {
    expect([...VENUE_ORDER].sort()).toEqual(Object.keys(VENUES).sort())
    expect(new Set(VENUE_ORDER).size).toBe(VENUE_ORDER.length)
  })

  it('gives every venue its own asset and a distinct camera', () => {
    const assets = VENUE_ORDER.map((id) => venueOf(id).asset)
    expect(new Set(assets).size).toBe(VENUE_ORDER.length)
    const radii = VENUE_ORDER.map((id) => venueOf(id).camera.radius)
    expect(new Set(radii).size).toBe(VENUE_ORDER.length)
  })

  it('keeps every seat ring inside its own camera orbit', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      expect(venue.seatRadius).toBeLessThan(venue.camera.radius)
    }
  })

  it('keeps the clear radius outside the orbit', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      expect(venue.camera.clearRadius).toBeGreaterThan(venue.camera.radius)
    }
  })

  it('reads the venue from the invite URL so a table shares one room', () => {
    expect(venueFromParams(new URLSearchParams('venue=suite'))).toBe('suite')
    expect(venueFromParams(new URLSearchParams('venue=BASEMENT'))).toBe('basement')
  })

  it('falls back rather than failing on a stale or missing venue', () => {
    expect(venueFromParams(new URLSearchParams(''))).toBe(DEFAULT_VENUE)
    expect(venueFromParams(new URLSearchParams('venue=casino-royale'))).toBe(DEFAULT_VENUE)
  })

  it('rejects values that are not venues', () => {
    expect(isVenueId('rooftop')).toBe(true)
    expect(isVenueId('penthouse')).toBe(false)
    expect(isVenueId(null)).toBe(false)
  })

  it('places seats on the ring of the venue it is given', () => {
    const tight = worldSeats(['a', 'b', 'c'], VENUES.suite.seatRadius)
    const wide = worldSeats(['a', 'b', 'c'], VENUES.rooftop.seatRadius)
    const spread = (seats: { x: number; z: number }[]) =>
      Math.hypot(seats[0]?.x ?? 0, seats[0]?.z ?? 0)
    expect(spread(tight)).toBeLessThan(spread(wide))
  })

  it('seats every player at a distinct position', () => {
    const seats = worldSeats(['a', 'b', 'c', 'd', 'e', 'f'])
    const keys = seats.map((seat) => `${seat.x.toFixed(3)}:${seat.z.toFixed(3)}`)
    expect(new Set(keys).size).toBe(seats.length)
  })
})
