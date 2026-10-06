import { describe, expect, it } from 'vitest'
import type { ScreenCamera, Vec3 } from './seat-projection.js'
import { projectToScreen, seatRing, verticalFovFrom } from './seat-projection.js'

const CENTRE: Vec3 = { x: 0, y: 0, z: 0 }
const ROOFTOP_CAMERA: ScreenCamera = {
  position: { x: 0, y: 6, z: 6 },
  target: CENTRE,
  verticalFovDegrees: 38.72,
  aspect: 16 / 9,
  near: 0.1,
  far: 100,
}

describe('seatRing', () => {
  it('returns nine distinct positions on the ring at the given height', () => {
    const seats = seatRing(9, 3.05, 0.54)
    expect(seats).toHaveLength(9)
    const unique = new Set(
      seats.map((seat) => `${Math.round(seat.x * 1e9)},${Math.round(seat.z * 1e9)}`),
    )
    expect(unique.size).toBe(9)
    for (const seat of seats) {
      expect(Math.abs(Math.hypot(seat.x, seat.z) - 3.05)).toBeLessThan(1e-12)
      expect(seat.y).toBe(0.54)
    }
  })

  it('puts seat 0 nearest the camera at azimuth 0 (the +Z side)', () => {
    const seats = seatRing(9, 3.05, 0.54)
    expect(seats[0]?.x).toBeCloseTo(0, 12)
    expect(seats[0]?.z).toBeCloseTo(3.05, 12)
  })

  it('returns empty for zero or negative counts and non-positive radius, without throwing', () => {
    expect(seatRing(0, 3.05, 0.54)).toHaveLength(0)
    expect(seatRing(-3, 3.05, 0.54)).toHaveLength(0)
    expect(seatRing(9, -1, 0.54)).toHaveLength(0)
    expect(seatRing(9, 0, 0.54)).toHaveLength(0)
  })
})

describe('projectToScreen', () => {
  it('projects the table centre to 50%, 50% when the camera looks at it', () => {
    const point = projectToScreen(CENTRE, ROOFTOP_CAMERA)
    expect(point.xPercent).toBeCloseTo(50, 6)
    expect(point.yPercent).toBeCloseTo(50, 6)
    expect(point.behind).toBe(false)
    expect(point.onScreen).toBe(true)
  })

  it('puts a seat at azimuth 0 nearer the bottom of the frame than a seat at azimuth PI', () => {
    const near = seatRing(9, 3.05, 0.54)[0] as Vec3
    const farIndex = Math.floor(9 / 2)
    const far = seatRing(9, 3.05, 0.54)[farIndex] as Vec3
    const nearPoint = projectToScreen(near, ROOFTOP_CAMERA)
    const farPoint = projectToScreen(far, ROOFTOP_CAMERA)
    expect(nearPoint.yPercent).toBeGreaterThan(farPoint.yPercent)
    expect(farPoint.yPercent).toBeLessThan(nearPoint.yPercent)
  })

  it('reports a point directly behind the camera as behind and not on screen', () => {
    const behindPoint: Vec3 = { x: 0, y: 20, z: 20 }
    const point = projectToScreen(behindPoint, ROOFTOP_CAMERA)
    expect(point.behind).toBe(true)
    expect(point.onScreen).toBe(false)
  })

  it('reports a point outside the frustum sides as on-screen false but not behind', () => {
    const farSide: Vec3 = { x: 50, y: 0, z: 0 }
    const point = projectToScreen(farSide, ROOFTOP_CAMERA)
    expect(point.behind).toBe(false)
    expect(point.onScreen).toBe(false)
  })

  it('is deterministic for identical inputs', () => {
    const a = projectToScreen(CENTRE, ROOFTOP_CAMERA)
    const b = projectToScreen(CENTRE, ROOFTOP_CAMERA)
    expect(b).toEqual(a)
  })
})

describe('verticalFovFrom', () => {
  it('converts 64 degrees at 16:9 to 38.73 to two decimals', () => {
    expect(verticalFovFrom(64, 16 / 9)).toBeCloseTo(38.732, 2)
  })

  it('returns 64 at aspect 1', () => {
    expect(verticalFovFrom(64, 1)).toBeCloseTo(64, 9)
  })

  it('returns the input unchanged for a zero or non-finite aspect', () => {
    expect(verticalFovFrom(64, 0)).toBe(64)
    expect(verticalFovFrom(64, NaN)).toBe(64)
    expect(verticalFovFrom(64, Infinity)).toBe(64)
    expect(verticalFovFrom(64, -1)).toBe(64)
  })

  it('narrows the vertical fov as the aspect widens', () => {
    const narrow = verticalFovFrom(64, 16 / 9)
    const wide = verticalFovFrom(64, 4)
    expect(wide).toBeLessThan(narrow)
  })
})
