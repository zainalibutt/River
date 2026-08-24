import { describe, expect, it } from 'vitest'
import {
  buyInScaleFor,
  computeRep,
  DEFAULT_REP_CONFIG,
  earningRatePercent,
  type RepInput,
} from './rep.js'

function input(overrides: Partial<RepInput> = {}): RepInput {
  return {
    wonHand: false,
    reachedShowdown: false,
    buyIn: DEFAULT_REP_CONFIG.buyInReference,
    tableItemModifiers: [],
    eventModifiers: [],
    challengeModifiers: [],
    otherModifiers: [],
    ...overrides,
  }
}

describe('rep earning', () => {
  it('pays base rep for a plain hand at the reference stake', () => {
    const rep = computeRep(input())
    expect(rep.buyInScale).toBe(1)
    expect(rep.totalRep).toBe(DEFAULT_REP_CONFIG.baseRepPerHand)
  })

  it('adds modifier rates rather than compounding them', () => {
    const three = computeRep(input({ tableItemModifiers: [0.1, 0.1, 0.1] }))
    const flat = computeRep(input({ tableItemModifiers: [0.3] }))
    expect(three.totalRep).toBe(flat.totalRep)
    // 33.1% would be the compounding answer, and is wrong.
    expect(three.totalRep).toBe(Math.round(DEFAULT_REP_CONFIG.baseRepPerHand * 1.3))
  })

  it('reconciles every breakdown field to the total exactly', () => {
    const cases: RepInput[] = [
      input(),
      input({ wonHand: true, reachedShowdown: true, buyIn: 250_000 }),
      input({ tableItemModifiers: [0.07], eventModifiers: [0.15], challengeModifiers: [0.03] }),
      input({ buyIn: 1, otherModifiers: [0.5] }),
    ]
    for (const one of cases) {
      const rep = computeRep(one)
      const summed =
        rep.baseRep + rep.tableItemBonus + rep.eventBonus + rep.challengeBonus + rep.otherBonus
      expect(summed).toBeCloseTo(rep.totalRep, 8)
    }
  })

  it('clamps the buy-in scale at both ends', () => {
    expect(buyInScaleFor(0, DEFAULT_REP_CONFIG)).toBe(DEFAULT_REP_CONFIG.buyInScaleMin)
    expect(buyInScaleFor(100_000_000, DEFAULT_REP_CONFIG)).toBe(DEFAULT_REP_CONFIG.buyInScaleMax)
  })

  it('does not pay a hundred times more rep for a hundred times the buy-in', () => {
    const small = computeRep(input({ buyIn: 10_000 }))
    const huge = computeRep(input({ buyIn: 1_000_000 }))
    expect(huge.totalRep / small.totalRep).toBeLessThan(6)
  })

  it('pays more for winning and more again for a won showdown', () => {
    const folded = computeRep(input()).totalRep
    const won = computeRep(input({ wonHand: true })).totalRep
    const wonShowdown = computeRep(input({ wonHand: true, reachedShowdown: true })).totalRep
    expect(won).toBeGreaterThan(folded)
    expect(wonShowdown).toBeGreaterThan(won)
  })

  it('never returns negative rep even with negative modifiers', () => {
    const rep = computeRep(input({ otherModifiers: [-5] }))
    expect(rep.totalRep).toBeGreaterThanOrEqual(0)
  })

  it('reports 100 percent when nothing modifies the rate', () => {
    expect(earningRatePercent(computeRep(input()))).toBe(100)
  })

  it('reports the earning rate as a modifier, not as level progress', () => {
    const rep = computeRep(input({ tableItemModifiers: [0.2] }))
    expect(earningRatePercent(rep)).toBe(120)
  })

  it('returns an integer total', () => {
    const rep = computeRep(input({ buyIn: 137_777, tableItemModifiers: [0.077] }))
    expect(Number.isInteger(rep.totalRep)).toBe(true)
  })

  it('reads no clock and no randomness', () => {
    const first = computeRep(input({ wonHand: true, buyIn: 123_456 }))
    const second = computeRep(input({ wonHand: true, buyIn: 123_456 }))
    expect(first).toEqual(second)
  })
})
