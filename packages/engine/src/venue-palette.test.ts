import { describe, expect, it } from 'vitest'
import type { Rgb, Surface } from './venue-palette.js'
import {
  checkPalette,
  contrastRatio,
  dominantIsBrightest,
  parseHex,
  relativeLuminance,
  valueSpread,
} from './venue-palette.js'

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const WHITE: Rgb = { r: 1, g: 1, b: 1 }

const MUTED_BROWN: Rgb = parseHex('D4C9B8') as Rgb
const DARK_TABLE: Rgb = parseHex('2b3128') as Rgb
const SUNNY_FLOOR: Rgb = parseHex('E8E2D4') as Rgb

describe('parseHex', () => {
  it('accepts all three accepted forms', () => {
    expect(parseHex('D9D4C6')).toEqual({ r: 217 / 255, g: 212 / 255, b: 198 / 255 })
    expect(parseHex('#D9D4C6')).toEqual({ r: 217 / 255, g: 212 / 255, b: 198 / 255 })
    expect(parseHex('#d9d4c6')).toEqual({ r: 217 / 255, g: 212 / 255, b: 198 / 255 })
  })

  it('returns null for shorthand, garbage, empty and overlong input', () => {
    expect(parseHex('#FFF')).toBeNull()
    expect(parseHex('ZZZZZZ')).toBeNull()
    expect(parseHex('')).toBeNull()
    expect(parseHex('ABCDEFG')).toBeNull()
    expect(parseHex('12345')).toBeNull()
    expect(parseHex('#0000GG')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white, to nine places', () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 9)
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 9)
  })
})

describe('contrastRatio', () => {
  it('is 21 for black against white', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6)
  })

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio(MUTED_BROWN, MUTED_BROWN)).toBeCloseTo(1, 9)
  })
})

describe('valueSpread', () => {
  it('is 0 for a single colour and 1 for black and white', () => {
    expect(valueSpread([BLACK])).toBeCloseTo(0, 9)
    expect(valueSpread([BLACK, WHITE])).toBeCloseTo(1, 9)
  })

  it('is 0 for an empty list', () => {
    expect(valueSpread([])).toBe(0)
  })
})

describe('dominantIsBrightest', () => {
  it('is true for a large pale floor beside a small dark table', () => {
    const surfaces: readonly Surface[] = [
      { colour: SUNNY_FLOOR, area: 80 },
      { colour: DARK_TABLE, area: 8 },
    ]
    expect(dominantIsBrightest(surfaces)).toBe(true)
  })

  it('is false when the largest surface is darker than a smaller bright one', () => {
    const surfaces: readonly Surface[] = [
      { colour: DARK_TABLE, area: 80 },
      { colour: SUNNY_FLOOR, area: 8 },
    ]
    expect(dominantIsBrightest(surfaces)).toBe(false)
  })

  it('is false for an empty list', () => {
    expect(dominantIsBrightest([])).toBe(false)
  })
})

describe('checkPalette', () => {
  it('passes a scheme with a dark dominant and a bright accent', () => {
    const surfaces: readonly Surface[] = [
      { colour: DARK_TABLE, area: 40 },
      { colour: MUTED_BROWN, area: 45 },
      { colour: SUNNY_FLOOR, area: 10 },
    ]
    expect(checkPalette(surfaces)).toHaveLength(0)
  })

  it('flags a palette with a value spread under 0.35', () => {
    const flat = [
      { colour: parseHex('CFCFC6') as Rgb, area: 30 },
      { colour: parseHex('BFBBAE') as Rgb, area: 30 },
      { colour: parseHex('A9A69C') as Rgb, area: 10 },
    ]
    const problems = checkPalette(flat)
    expect(problems.some((problem) => problem.includes('value spread'))).toBe(true)
  })

  it('flags a palette whose largest surface is the brightest', () => {
    const surfaces: readonly Surface[] = [
      { colour: SUNNY_FLOOR, area: 80 },
      { colour: DARK_TABLE, area: 8 },
    ]
    const problems = checkPalette(surfaces)
    expect(
      problems.some(
        (problem) => problem.includes('biggest surface') && problem.includes('brightest'),
      ),
    ).toBe(true)
  })

  it('flags two large surfaces with contrast under 1.4', () => {
    const surfaces: readonly Surface[] = [
      { colour: parseHex('C9C2B6') as Rgb, area: 30 },
      { colour: parseHex('D2CBBB') as Rgb, area: 28 },
      { colour: DARK_TABLE, area: 5 },
    ]
    const problems = checkPalette(surfaces)
    expect(problems.some((problem) => problem.includes('read as one shape'))).toBe(true)
  })

  it('does not flag two large surfaces when their contrast is adequate', () => {
    const surfaces: readonly Surface[] = [
      { colour: DARK_TABLE, area: 30 },
      { colour: MUTED_BROWN, area: 28 },
      { colour: SUNNY_FLOOR, area: 5 },
    ]
    const problems = checkPalette(surfaces)
    expect(problems.some((problem) => problem.includes('read as one shape'))).toBe(false)
  })

  it('is deterministic for identical input', () => {
    const surfaces: readonly Surface[] = [
      { colour: SUNNY_FLOOR, area: 80 },
      { colour: DARK_TABLE, area: 8 },
    ]
    const first = checkPalette(surfaces)
    const second = checkPalette(surfaces)
    expect(second).toEqual(first)
  })
})
