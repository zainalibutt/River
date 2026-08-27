import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAKE,
  DEFAULT_TABLE_SHAPE,
  SEATS_PER_SHAPE,
  STAKE_250_500,
  TABLE_SHAPES,
} from './config.js'

describe('config', () => {
  it('keeps buy-in within a sane depth range', () => {
    const bigBlind = STAKE_250_500.bigBlind
    expect(STAKE_250_500.minBuyIn).toBe(100 * bigBlind)
    expect(STAKE_250_500.defaultBuyIn).toBe(200 * bigBlind)
    expect(STAKE_250_500.maxBuyIn).toBe(400 * bigBlind)
    expect(STAKE_250_500.minBuyIn).toBeLessThan(STAKE_250_500.maxBuyIn)
  })

  it('exports one default stake at 250/500', () => {
    expect(DEFAULT_STAKE).toBe(STAKE_250_500)
    expect(STAKE_250_500.smallBlind).toBe(250)
    expect(STAKE_250_500.bigBlind).toBe(500)
  })

  it('maps every table shape to a seat count', () => {
    for (const shape of TABLE_SHAPES) {
      expect(SEATS_PER_SHAPE[shape]).toBeGreaterThan(1)
    }
    // Eight, because the ninth place around the felt is the dealer's. The
    // venue lays nine slots and stands its dealer in the first.
    expect(SEATS_PER_SHAPE[DEFAULT_TABLE_SHAPE]).toBe(8)
  })
})
