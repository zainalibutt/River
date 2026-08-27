import { SEATS_PER_SHAPE } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { blenderToThree } from '@/lib/lighting'
import {
  cameraPlacement,
  DEFAULT_VENUE,
  isVenueId,
  ORBIT_POLAR_DEGREES,
  SEAT_SLOTS,
  TABLE_SURFACE_HEIGHT,
  VENUE_ORDER,
  VENUES,
  venueFromParams,
  venueOf,
  verticalFov,
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
      expect(Math.max(venue.seatRing.x, venue.seatRing.y)).toBeLessThan(venue.camera.radius)
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
    const tight = worldSeats(['a', 'b', 'c'], VENUES.suite.seatRing)
    const wide = worldSeats(['a', 'b', 'c'], VENUES.rooftop.seatRing)
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
      expect(polarDegrees).toBeGreaterThanOrEqual(ORBIT_POLAR_DEGREES.min)
      expect(polarDegrees).toBeLessThanOrEqual(ORBIT_POLAR_DEGREES.max)
    }
  })

  it('clears the seat ring, so the orbit never passes through a player', () => {
    for (const id of VENUE_ORDER) {
      const venue = venueOf(id)
      const run = Math.hypot(...[0, 2].map((axis) => cameraPlacement(venue).position[axis] ?? 0))
      expect(run).toBeGreaterThan(Math.max(venue.seatRing.x, venue.seatRing.y))
    }
  })
})

describe('field of view', () => {
  it('narrows a horizontal angle into the vertical one three.js reads', () => {
    // Blender fits a landscape camera horizontally. 64 degrees across a 16:9
    // frame is 38.7 degrees tall, and handing 64 straight to three.js asks for
    // a view most of a right angle wider than the one that was measured.
    expect(verticalFov(64, 16 / 9)).toBeCloseTo(38.72, 1)
    expect(verticalFov(66, 16 / 9)).toBeCloseTo(40.13, 1)
  })

  it('leaves a square frame alone', () => {
    expect(verticalFov(64, 1)).toBeCloseTo(64, 6)
  })

  it('narrows further as the frame gets wider', () => {
    const wide = verticalFov(64, 21 / 9)
    const standard = verticalFov(64, 16 / 9)
    expect(wide).toBeLessThan(standard)
    expect(standard).toBeLessThan(verticalFov(64, 4 / 3))
  })

  it('refuses to divide by a frame with no height', () => {
    expect(verticalFov(64, 0)).toBe(64)
    expect(verticalFov(64, Number.NaN)).toBe(64)
  })

  it('never widens the measured angle on a landscape frame', () => {
    for (const id of VENUE_ORDER) {
      const measured = venueOf(id).camera.fov
      expect(verticalFov(measured, 16 / 9)).toBeLessThan(measured)
    }
  })
})

describe('seat ring', () => {
  it('lays seats on the same ellipse the pipeline seats characters on', () => {
    // art/pipeline: seat_positions(count, FELT_RX * 1.42, FELT_RY * 1.58),
    // then (x, y, z) becomes (x, z, -y). A circle here puts the side seats a
    // metre off the chairs they label, which is what a single radius did.
    const ring = VENUES.rooftop.seatRing
    const seats = worldSeats(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ring)
    // The ring keeps nine slots however many players are sitting, because the
    // chairs are baked on it. Players take slots 1 to 8; slot 0 is the dealer's.
    seats.forEach((seat, index) => {
      const angle = Math.PI / 2 + ((index + 1) * Math.PI * 2) / SEAT_SLOTS
      expect(seat.x).toBeCloseTo(ring.x * Math.cos(angle), 9)
      expect(seat.z).toBeCloseTo(-ring.y * Math.sin(angle), 9)
    })
  })

  it('leaves the dealer their slot rather than seating somebody inside them', () => {
    // The venue stands its dealer in the first slot of the ring. A ninth
    // playable seat put a player at that exact coordinate, so somebody was
    // always inside the dealer.
    const ring = VENUES.rooftop.seatRing
    const dealerAngle = Math.PI / 2
    const dealer = { x: ring.x * Math.cos(dealerAngle), z: -ring.y * Math.sin(dealerAngle) }
    for (const seat of worldSeats(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], ring)) {
      expect(Math.hypot(seat.x - dealer.x, seat.z - dealer.z)).toBeGreaterThan(0.4)
    }
    expect(SEATS_PER_SHAPE.full).toBeLessThan(SEAT_SLOTS)
  })

  it('is an ellipse, not a circle', () => {
    for (const id of VENUE_ORDER) {
      const ring = venueOf(id).seatRing
      expect(ring.x).not.toBeCloseTo(ring.y, 2)
      expect(ring.x).toBeGreaterThan(ring.y)
    }
  })

  it('starts the ring one slot past the dealer, the way the pipeline seats it', () => {
    const ring = VENUES.rooftop.seatRing
    const [first] = worldSeats(['a', 'b', 'c', 'd'], ring)
    if (first === undefined) throw new Error('expected a seat')
    // Slot 0 is across the table and belongs to the dealer, so the first
    // player sits one slot round from it. What matters is that the labels agree
    // with the chairs the pipeline baked, not which absolute point they land on.
    const angle = Math.PI / 2 + (Math.PI * 2) / SEAT_SLOTS
    expect(first.x).toBeCloseTo(ring.x * Math.cos(angle), 9)
    expect(first.z).toBeCloseTo(-ring.y * Math.sin(angle), 9)
  })

  it('keeps every seat inside the ring it was given', () => {
    const ring = VENUES.rooftop.seatRing
    for (const seat of worldSeats(['a', 'b', 'c', 'd', 'e'], ring)) {
      expect(Math.abs(seat.x)).toBeLessThanOrEqual(ring.x + 1e-9)
      expect(Math.abs(seat.z)).toBeLessThanOrEqual(ring.y + 1e-9)
    }
  })
})
