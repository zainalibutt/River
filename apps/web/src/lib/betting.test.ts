import { describe, expect, it } from 'vitest'
import { raiseToForPotFraction, type SizingState, sizingPresets } from './betting'

/**
 * Both fixtures are states read off a live Rooftop table on 10 September 2026,
 * not invented numbers. The second is the state that exposed the defect: MIN
 * and half-pot both returned 2,500 and POT returned the pot itself.
 */
const buttonPreflop: SizingState = {
  pot: 750,
  currentBet: 500,
  toCall: 500,
  minRaiseTo: 1_000,
  allInTo: 100_000,
}

const facingARaise: SizingState = {
  pot: 3_650,
  currentBet: 1_300,
  toCall: 1_300,
  minRaiseTo: 2_500,
  allInTo: 100_000,
}

describe('raise-to sizing', () => {
  it('counts the call twice in a pot-sized raise', () => {
    expect(raiseToForPotFraction(buttonPreflop, 1)).toBe(1_750)
  })

  it('sizes a half-pot raise from the pot the raiser leaves behind', () => {
    expect(raiseToForPotFraction(buttonPreflop, 0.5)).toBe(1_125)
    expect(raiseToForPotFraction(facingARaise, 0.5)).toBe(3_775)
  })

  it('does not read the pot as a raise-to total', () => {
    expect(raiseToForPotFraction(facingARaise, 1)).toBe(6_250)
    expect(raiseToForPotFraction(facingARaise, 1)).not.toBe(facingARaise.pot)
  })

  it('offers three-quarter pot rather than a second all-in', () => {
    const rail = sizingPresets(facingARaise)
    expect(rail.map((preset) => preset.id)).toEqual([
      'minimum',
      'half-pot',
      'three-quarter-pot',
      'pot',
    ])
    expect(rail.map((preset) => preset.amount)).toEqual([2_500, 3_775, 5_013, 6_250])
    expect(rail.some((preset) => preset.amount === facingARaise.allInTo)).toBe(false)
  })

  it('returns whole chips', () => {
    const oddPot: SizingState = { ...facingARaise, pot: 3_651 }
    for (const preset of sizingPresets(oddPot)) {
      expect(Number.isSafeInteger(preset.amount)).toBe(true)
    }
  })

  it('never returns an illegal amount', () => {
    const shortStack: SizingState = { ...facingARaise, allInTo: 3_000 }
    for (const preset of sizingPresets(shortStack)) {
      expect(preset.amount).toBeGreaterThanOrEqual(shortStack.minRaiseTo)
      expect(preset.amount).toBeLessThanOrEqual(shortStack.allInTo)
    }
  })

  it('gives four distinct sizes where the stack allows four', () => {
    const amounts = sizingPresets(facingARaise).map((preset) => preset.amount)
    expect(new Set(amounts).size).toBe(4)
  })

  it('collapses presets only when the stack genuinely leaves no room', () => {
    const allInOrFold: SizingState = { ...facingARaise, allInTo: 2_500 }
    const amounts = sizingPresets(allInOrFold).map((preset) => preset.amount)
    expect(new Set(amounts).size).toBe(1)
  })
})
