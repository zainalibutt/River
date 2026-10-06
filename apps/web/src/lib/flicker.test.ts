import { describe, expect, it } from 'vitest'
import { FIRE_LIGHT, fireLevel, fireLightLevel } from './flicker.js'

describe('fire flicker', () => {
  const samples = Array.from({ length: 4000 }, (_, index) => fireLevel(index * 0.005))

  it('stays within a quarter of its own strength', () => {
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.77)
    expect(Math.max(...samples)).toBeLessThanOrEqual(1.23)
  })

  it('moves, rather than sitting still like a painted flame', () => {
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.2)
  })

  it('never steps between two frames', () => {
    const steps = samples.slice(1).map((level, index) => Math.abs(level - (samples[index] ?? 1)))
    expect(Math.max(...steps)).toBeLessThan(0.02)
  })

  it('gives the same level for the same moment', () => {
    expect(fireLevel(12.345)).toBe(fireLevel(12.345))
  })

  it('moves the light half as far as the flame', () => {
    for (const seconds of [0, 0.4, 1.7, 9.2]) {
      expect(fireLightLevel(seconds) - 1).toBeCloseTo((fireLevel(seconds) - 1) / 2, 9)
    }
  })

  it('flickers the fire lights and nothing else in the rig', () => {
    expect(FIRE_LIGHT.test('fire_key')).toBe(true)
    expect(FIRE_LIGHT.test('fire_run')).toBe(true)
    expect(FIRE_LIGHT.test('table')).toBe(false)
    expect(FIRE_LIGHT.test('bar')).toBe(false)
  })
})
