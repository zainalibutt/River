import { describe, expect, it } from 'vitest'
import { estimateRangeSensitivity, opponentRangeContext } from './bot-range-context.js'
import { parseCard } from './cards.js'
import type { HandAction } from './hand-history.js'
import type { OpponentModelSummaryV1 } from './opponent-model.js'

const raise: HandAction = {
  seat: 2,
  street: 'preflop',
  action: { kind: 'raiseTo', to: 1_500 },
  streetBetAfter: 1_500,
}
const prior: OpponentModelSummaryV1 = {
  version: 1,
  sampleCount: 40,
  confidence: 0.9,
  vpip: 0.4,
  pfr: 0.4,
  aggressionFrequency: 0.5,
  showdownFrequency: 0.25,
  averageAggressivePotRatio: 0.7,
}

describe('offline public-action range sensitivity', () => {
  it('keeps weak reads from changing the central hypothesis', () => {
    const weak = { ...prior, confidence: 0.1, pfr: 0.03 }
    expect(opponentRangeContext(2, [raise], weak)).toMatchObject({
      pressure: 'raised',
      centralScenario: 'tight',
      usedPriorRead: false,
    })
    expect(opponentRangeContext(2, [raise], prior)).toMatchObject({
      pressure: 'raised',
      centralScenario: 'loose',
      usedPriorRead: true,
    })
    expect(opponentRangeContext(2, [raise], { ...prior, pfr: 0.05 }).centralScenario).toBe(
      'premium',
    )
  })

  it('distinguishes a reraise from a call-all-in using public street totals', () => {
    const opening = { ...raise, seat: 1 }
    const callingAllIn: HandAction = {
      seat: 2,
      street: 'preflop',
      action: { kind: 'allIn' },
      streetBetAfter: 1_500,
    }
    const reraisingAllIn = { ...callingAllIn, streetBetAfter: 3_000 }
    expect(opponentRangeContext(2, [opening, callingAllIn]).pressure).toBe('passive')
    expect(opponentRangeContext(2, [opening, reraisingAllIn]).pressure).toBe('reraised')
    expect(opponentRangeContext(2, [{ ...raise, street: 'flop' }]).pressure).toBe('unobserved')
  })

  it('reports an uncertainty span instead of inventing an opponent hand', () => {
    const options = {
      hole: [parseCard('As'), parseCard('Ks')] as const,
      board: ['Qs', 'Js', '2c'].map(parseCard),
      opponentSeat: 2,
      actions: [raise],
      seed: 'held-out-range-sensitivity',
      trials: 150,
    }
    const result = estimateRangeSensitivity(options)
    expect(estimateRangeSensitivity(options)).toEqual(result)
    expect(Object.keys(result.scenarios)).toEqual(['random', 'loose', 'tight', 'premium'])
    expect(result.minimumPotShare).toBeLessThanOrEqual(result.centralPotShare)
    expect(result.centralPotShare).toBeLessThanOrEqual(result.maximumPotShare)
    expect(result.maximumPotShare).toBeGreaterThan(result.minimumPotShare)
    expect(result).not.toHaveProperty('opponentHole')
  })
})
