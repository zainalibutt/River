import { describe, expect, it } from 'vitest'
import { blenderToThree } from '@/lib/lighting'
import {
  cameraPlacement,
  DEFAULT_VENUE,
  isVenueId,
  TABLE_SURFACE_HEIGHT,
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

describe('camera placement', () => {
  it('agrees with the conversion every light already goes through', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      // This is the whole point. The pipeline puts the play camera at Blender
      // (0, -radius, height); anything that disagrees with blenderToThree here
      // is looking at the room from a different world to the one lighting it.
      expect(cameraPlacement(venue).position).toEqual(
        blenderToThree([0, -venue.camera.radius, venue.camera.height]),
      )
    }
  })

  it('seats the camera on the side of the table the venue was framed from', () => {
    // The scene used to hardcode -radius on Z, putting the camera diametrically
    // opposite the measured position. Round venue, so it still rendered - it
    // just rendered the back of the room lit for the front.
    for (const id of VENUE_ORDER) {
      const [x, y, z] = cameraPlacement(venueOf(id)).position
      expect(x).toBe(0)
      expect(y).toBeGreaterThan(TABLE_SURFACE_HEIGHT)
      expect(z).toBeGreaterThan(0)
    }
  })

  it('looks at the felt rather than the floor', () => {
    for (const id of VENUE_ORDER) {
      expect(cameraPlacement(venueOf(id)).target).toEqual([0, TABLE_SURFACE_HEIGHT, 0])
    }
  })

  it('measures its orbit radius to the target, not to the origin', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      const placement = cameraPlacement(venue)
      // Locking the orbit to hypot(radius, height) pushes the camera outwards
      // on the first update, because the target sits above the origin.
      expect(placement.distance).toBeCloseTo(
        Math.hypot(venue.camera.radius, venue.camera.height - TABLE_SURFACE_HEIGHT),
        6,
      )
      expect(placement.distance).toBeLessThan(Math.hypot(venue.camera.radius, venue.camera.height))
    }
  })

  it('sits inside the polar range the orbit controls allow', () => {
    // Outside it, the controls silently move the camera on the first frame and
    // the measured framing is lost before anyone sees it.
    for (const id of VENUE_ORDER) {
      const placement = cameraPlacement(venueOf(id))
      const rise = placement.position[1] - placement.target[1]
      const run = Math.hypot(placement.position[0], placement.position[2])
      const polarDegrees = (Math.atan2(run, rise) * 180) / Math.PI
      expect(polarDegrees).toBeGreaterThanOrEqual(50)
      expect(polarDegrees).toBeLessThanOrEqual(70)
    }
  })

  it('clears the seat ring, so the orbit never passes through a player', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      const run = Math.hypot(...[0, 2].map((axis) => cameraPlacement(venue).position[axis] ?? 0))
      expect(run).toBeGreaterThan(venue.seatRadius)
    }
  })
})
