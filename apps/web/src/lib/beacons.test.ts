import { describe, expect, it } from 'vitest'
import { BEACON_MESH, BEACON_PERIOD_SECONDS, beaconLevel } from './beacons.js'

describe('skyline beacons', () => {
  it('finds the mesh the pipeline names, and nothing else on the skyline', () => {
    expect(BEACON_MESH.test('rooftop_skyline_beacons')).toBe(true)
    expect(BEACON_MESH.test('rooftop_skyline')).toBe(false)
  })

  it('is fully on early in each flash and fully off for most of the period', () => {
    expect(beaconLevel(0.35)).toBeCloseTo(1, 5)
    expect(beaconLevel(1.4)).toBe(0)
    expect(beaconLevel(0.35 + BEACON_PERIOD_SECONDS * 7)).toBeCloseTo(1, 5)
  })

  it('eases rather than switching, and never leaves the unit range', () => {
    const levels = Array.from({ length: 400 }, (_, index) =>
      beaconLevel((index / 400) * BEACON_PERIOD_SECONDS),
    )
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
    }
    // A switch would jump the whole range between two samples 5ms apart.
    const steps = levels.slice(1).map((level, index) => Math.abs(level - (levels[index] ?? 0)))
    expect(Math.max(...steps)).toBeLessThan(0.1)
    expect(levels.filter((level) => level > 0 && level < 1).length).toBeGreaterThan(10)
  })

  it('keeps time through negative and very large clocks', () => {
    expect(beaconLevel(-BEACON_PERIOD_SECONDS + 0.35)).toBeCloseTo(beaconLevel(0.35), 5)
    expect(beaconLevel(86400 + 0.35)).toBeCloseTo(beaconLevel(0.35), 5)
  })
})
