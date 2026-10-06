import { describe, expect, it } from 'vitest'
import { mulberry32, seedFromString } from './rng.js'

describe('rng', () => {
  it('produces values in [0, 1)', () => {
    const rng = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('is deterministic for the same seed', () => {
    const first = mulberry32(1234)
    const second = mulberry32(1234)
    for (let i = 0; i < 100; i++) {
      expect(first()).toBe(second())
    }
  })

  it('differs across seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const samplesA = [a(), a(), a()]
    const samplesB = [b(), b(), b()]
    expect(samplesA).not.toEqual(samplesB)
  })

  it('hashes strings to stable seeds', () => {
    expect(seedFromString('hello')).toBe(seedFromString('hello'))
    expect(seedFromString('hello')).not.toBe(seedFromString('world'))
  })
})
