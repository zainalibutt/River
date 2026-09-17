import { describe, expect, it } from 'vitest'
import { ACCENTS, accentFor, PLAYER_SEATS } from './seat-accents'

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

describe('seat accents', () => {
  it('leaves the local player in the accepted look and gives the other seven one colour each', () => {
    for (let hero = 0; hero < PLAYER_SEATS; hero += 1) {
      expect(accentFor(hero, hero)).toBeNull()
      const given = Array.from({ length: PLAYER_SEATS }, (_, seat) => accentFor(seat, hero)).filter(
        (accent) => accent !== null,
      )
      expect(given.length).toBe(7)
      expect(new Set(given.map((accent) => accent?.name)).size).toBe(7)
    }
  })

  it('uses every accent exactly once around the table', () => {
    const names = Array.from({ length: PLAYER_SEATS }, (_, seat) => accentFor(seat, 3)?.name)
    expect(names.filter((name) => name !== undefined).sort()).toEqual(
      ACCENTS.map((accent) => accent.name).sort(),
    )
  })

  it('gives the same seat the same colour every time for the same local player', () => {
    expect(accentFor(6, 2)).toEqual(accentFor(6, 2))
    expect(accentFor(3, 2)?.name).toBe('magenta')
  })

  it('treats a spectator as sitting in seat 0', () => {
    expect(accentFor(0, null)).toBeNull()
    expect(accentFor(1, null)?.name).toBe('magenta')
  })

  it('has nothing for a seat that is not at the table', () => {
    expect(accentFor(-1, 0)).toBeNull()
    expect(accentFor(PLAYER_SEATS, 0)).toBeNull()
    expect(accentFor(2.5, 0)).toBeNull()
  })

  it('keeps every pair of accents clearly apart', () => {
    // A colour identifier that two seats nearly share identifies nobody.
    let closest = Number.POSITIVE_INFINITY
    for (const [index, first] of ACCENTS.entries()) {
      for (const second of ACCENTS.slice(index + 1)) {
        const [r1, g1, b1] = rgb(first.hex)
        const [r2, g2, b2] = rgb(second.hex)
        closest = Math.min(closest, Math.hypot(r1 - r2, g1 - g2, b1 - b2))
      }
    }
    expect(closest).toBeGreaterThan(100)
  })
})
