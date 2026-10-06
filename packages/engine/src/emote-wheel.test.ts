import { describe, expect, it } from 'vitest'
import { wheelSelection } from './emote-wheel.js'

function pointForDegrees(degrees: number, radius = 1): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) }
}

describe('wheelSelection', () => {
  it('selects nothing in the dead zone at the centre', () => {
    expect(wheelSelection(0, 0, 8).index).toBeNull()
    expect(wheelSelection(0.1, 0.05, 8).index).toBeNull()
  })

  it('sees a deep but inside the dead zone deflection as no selection', () => {
    expect(wheelSelection(0.12, 0.12, 8).index).toBeNull()
  })

  it('clamps reach to 1 for an offdriven stick', () => {
    expect(wheelSelection(5, 0, 8).reach).toBe(1)
  })

  it('maps straight up to the first segment', () => {
    expect(wheelSelection(0, -1, 8).index).toBe(0)
    expect(wheelSelection(0, -1, 3).index).toBe(0)
  })

  it('wraps at twelve o clock: a hair above selects the first, a hair below the last', () => {
    const above = pointForDegrees(0.05)
    const below = pointForDegrees(359.95)
    const count = 4
    expect(wheelSelection(above.x, above.y, count).index).toBe(0)
    expect(wheelSelection(below.x, below.y, count).index).toBe(count - 1)
  })

  it('returns null for count 0 and index 0 for count 1 outside the dead zone', () => {
    expect(wheelSelection(0, -1, 0).index).toBeNull()
    expect(wheelSelection(0.6, 0.6, 1).index).toBe(0)
  })

  it('is total for non-finite input', () => {
    expect(wheelSelection(Number.NaN, 0.5, 8).index).toBeNull()
    expect(wheelSelection(0.5, Number.POSITIVE_INFINITY, 8).index).toBeNull()
    expect(wheelSelection(0.5, 0.5, Number.NaN).index).toBeNull()
  })

  it('walks the full circle and changes index exactly count times per revolution', () => {
    for (const count of [2, 3, 4, 6, 8]) {
      let previous: number | null = null
      let changes = 0
      for (let degree = 0; degree <= 360; degree += 1) {
        const point = pointForDegrees(degree)
        const selection = wheelSelection(point.x, point.y, count)
        expect(selection.index).not.toBeNull()
        expect(selection.index).toBeGreaterThanOrEqual(0)
        expect(selection.index).toBeLessThan(count)
        if (previous !== null && selection.index !== previous) {
          changes += 1
        }
        previous = selection.index
      }
      expect(changes).toBe(count)
    }
  })

  it('never shares a boundary - adjacent below and above resolve to different indices', () => {
    for (const count of [2, 3, 4, 6, 8]) {
      const stepDegrees = 360 / count
      for (let b = 0; b < 360; b += stepDegrees) {
        const belowPoint = pointForDegrees((((b - 0.05) % 360) + 360) % 360)
        const abovePoint = pointForDegrees((((b + 0.05) % 360) + 360) % 360)
        const below = wheelSelection(belowPoint.x, belowPoint.y, count).index
        const above = wheelSelection(abovePoint.x, abovePoint.y, count).index
        expect(below).not.toBe(above)
      }
    }
  })

  it('treats down as a different screen point from up for an even count', () => {
    const up = wheelSelection(0, -1, 4).index
    const down = wheelSelection(0, 1, 4).index
    expect(up).not.toBe(down)
    expect(up).toBe(0)
  })

  it('is deterministic for identical input', () => {
    expect(wheelSelection(0.5, 0.5, 8)).toEqual(wheelSelection(0.5, 0.5, 8))
  })
})
