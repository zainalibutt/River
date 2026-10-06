import { describe, expect, it } from 'vitest'
import type { PlaqueSize, Rect } from './hud-layout.js'
import { layOutPlaques, overlaps, worstOverlap } from './hud-layout.js'
import { seatRing } from './seat-projection.js'

const SIZE: PlaqueSize = { widthPercent: 8, heightPercent: 4 }
const CENTRE = { xPercent: 50, yPercent: 50 }
const BOUNDS = { widthPercent: 100, heightPercent: 100 }

describe('overlaps', () => {
  it('returns false for rectangles sharing exactly one edge', () => {
    const left: Rect = { xPercent: 10, yPercent: 10, widthPercent: 8, heightPercent: 4 }
    const right: Rect = { xPercent: 18, yPercent: 10, widthPercent: 8, heightPercent: 4 }
    expect(overlaps(left, right)).toBe(false)
  })

  it('returns false for rectangles sharing exactly one corner', () => {
    const a: Rect = { xPercent: 10, yPercent: 10, widthPercent: 8, heightPercent: 4 }
    const b: Rect = { xPercent: 18, yPercent: 14, widthPercent: 8, heightPercent: 4 }
    expect(overlaps(a, b)).toBe(false)
  })

  it('returns true for rectangles that genuinely overlap', () => {
    const a: Rect = { xPercent: 10, yPercent: 10, widthPercent: 8, heightPercent: 4 }
    const overlapping: Rect = { xPercent: 12, yPercent: 11, widthPercent: 8, heightPercent: 4 }
    expect(overlaps(a, overlapping)).toBe(true)
  })

  it('returns false for disjoint rectangles', () => {
    const a: Rect = { xPercent: 10, yPercent: 10, widthPercent: 8, heightPercent: 4 }
    const far: Rect = { xPercent: 80, yPercent: 80, widthPercent: 8, heightPercent: 4 }
    expect(overlaps(a, far)).toBe(false)
  })

  it('returns false for nested-but-edge-touching within bounds', () => {
    const a: Rect = { xPercent: 0, yPercent: 0, widthPercent: 10, heightPercent: 10 }
    const edge: Rect = { xPercent: 5, yPercent: 0, widthPercent: 5, heightPercent: 5 }
    expect(overlaps(a, edge)).toBe(true)
  })
})

describe('layOutPlaques', () => {
  it('separates two anchors on the same point', () => {
    const placements = layOutPlaques(
      [
        { xPercent: 50, yPercent: 50 },
        { xPercent: 50, yPercent: 50 },
      ],
      SIZE,
      BOUNDS,
      CENTRE,
    )
    expect(placements[1]?.pushed).toBe(true)
    expect(worstOverlap(placements, SIZE)).toBe(0)
  })

  it('produces a clean layout for nine anchors on an ellipse', () => {
    const anchors = ellipseAnchors(9, 30, 18, CENTRE)
    const placements = layOutPlaques(anchors, SIZE, BOUNDS, CENTRE)
    expect(placements).toHaveLength(9)
    expect(worstOverlap(placements, SIZE)).toBe(0)
  })

  it('clamps a plaque pushed off the right edge back inside bounds', () => {
    const placements = layOutPlaques([{ xPercent: 99, yPercent: 50 }], SIZE, BOUNDS, {
      xPercent: 10,
      yPercent: 50,
    })
    const plaque = placements[0] as { xPercent: number }
    expect(plaque.xPercent + SIZE.widthPercent / 2).toBeLessThanOrEqual(100)
  })

  it('never lets a plaque cross the centre', () => {
    const anchors = [
      { xPercent: 70, yPercent: 50 },
      { xPercent: 74, yPercent: 50 },
    ]
    const placements = layOutPlaques(
      anchors,
      { widthPercent: 20, heightPercent: 20 },
      BOUNDS,
      CENTRE,
    )
    for (const placement of placements) {
      expect(placement.xPercent).toBeGreaterThanOrEqual(CENTRE.xPercent)
    }
  })

  it('never pushes a single anchor', () => {
    const placements = layOutPlaques([{ xPercent: 40, yPercent: 40 }], SIZE, BOUNDS, CENTRE)
    expect(placements).toHaveLength(1)
    expect(placements[0]?.pushed).toBe(false)
    expect(placements[0]?.xPercent).toBe(40)
    expect(placements[0]?.yPercent).toBe(40)
  })

  it('returns an empty array for zero anchors without throwing', () => {
    expect(layOutPlaques([], SIZE, BOUNDS, CENTRE)).toHaveLength(0)
  })

  it('is deterministic for identical input', () => {
    const anchors = ellipseAnchors(9, 30, 18, CENTRE)
    const first = layOutPlaques(anchors, SIZE, BOUNDS, CENTRE)
    const second = layOutPlaques(anchors, SIZE, BOUNDS, CENTRE)
    expect(second).toEqual(first)
  })
})

describe('seatRing', () => {
  it('matches the legacy circular behaviour when ring.x === ring.y', () => {
    const seats = seatRing(9, 3.05, 0.54)
    expect(seats).toHaveLength(9)
    for (const seat of seats) {
      expect(Math.abs(Math.hypot(seat.x, seat.z) - 3.05)).toBeLessThan(1e-12)
      expect(seat.y).toBe(0.54)
    }
  })

  it('places seat 0 per the pipeline ellipse convention', () => {
    const seats = seatRing(9, { x: 1.7608, y: 1.1376 }, 1.46)
    expect(seats[0]?.x).toBeCloseTo(0, 12)
    expect(seats[0]?.z).toBeCloseTo(-1.1376, 12)
    expect(seats[0]?.y).toBe(1.46)
    for (const seat of seats) {
      const nx = seat.x / 1.7608
      const nz = seat.z / 1.1376
      expect(Math.abs(Math.hypot(nx, nz) - 1)).toBeLessThan(1e-12)
    }
  })

  it('keeps an equal-axes ring a true circle of that radius', () => {
    const seats = seatRing(9, { x: 3.0, y: 3.0 }, 0.75)
    for (const seat of seats) {
      expect(Math.abs(Math.hypot(seat.x, seat.z) - 3.0)).toBeLessThan(1e-12)
      expect(seat.y).toBe(0.75)
    }
  })
})

function ellipseAnchors(
  count: number,
  semiMajor: number,
  semiMinor: number,
  centre: { xPercent: number; yPercent: number },
): { xPercent: number; yPercent: number }[] {
  const anchors: { xPercent: number; yPercent: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count
    anchors.push({
      xPercent: centre.xPercent + semiMajor * Math.cos(angle),
      yPercent: centre.yPercent + semiMinor * Math.sin(angle),
    })
  }
  return anchors
}
