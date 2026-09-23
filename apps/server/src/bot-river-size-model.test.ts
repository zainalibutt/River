import { cardKey, HandCategory } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  riverShareAfterBet,
} from './bot-river-bet-model.js'
import {
  enumerateSizedRiverBetEvidence,
  inferRiverStyleWeightsFromSizeHistory,
  trainRiverBetSizeModel,
} from './bot-river-size-model.js'
import {
  generateSizedRiverScenarios,
  riverBetSizeFromObservation,
  sampleSizedRiverTrainingExamples,
} from './bot-river-size-scenarios.js'

describe('offline size-conditioned river model', () => {
  it('fits reproducible legal size likelihoods without importing the bettor oracle', () => {
    const model = trainRiverBetSizeModel('size-fit-test', 1_000)
    expect(trainRiverBetSizeModel('size-fit-test', 1_000)).toEqual(model)
    expect(model.likelihood.balanced.medium.highCard).toBeGreaterThan(
      model.likelihood.balanced.large.highCard,
    )
    expect(model.likelihood.overbluff.small.pair).toBeGreaterThan(
      model.likelihood.overbluff.large.pair,
    )
  })

  it('changes the public bet price and legal actions consistently across size buckets', () => {
    const options = { seed: 'size-scenario-contract', count: 100, style: 'overbluff' as const }
    const scenarios = generateSizedRiverScenarios(options)
    expect(generateSizedRiverScenarios(options)).toEqual(scenarios)
    expect(new Set(scenarios.map((row) => riverBetSizeFromObservation(row.observation))).size).toBe(
      3,
    )
    for (const { observation, oracle } of scenarios) {
      expect(observation.pot).toBe(2_000 + observation.amountToCall)
      expect(observation.legal.call.amount).toBe(observation.amountToCall)
      expect(observation.seats[1]?.betStreet).toBe(observation.amountToCall)
      expect(observation.actions?.[0]?.amountCommitted).toBe(observation.amountToCall)
      expect(observation).not.toHaveProperty('opponentHole')
      expect(
        new Set(
          [...observation.actor.hole, ...observation.board, ...oracle.opponentHole].map(cardKey),
        ).size,
      ).toBe(9)
    }
    for (const scenario of scenarios) {
      const counts = scenario.publicHistory.sizeCounts
      if (counts === undefined) throw new Error('missing public size history')
      expect(counts.small + counts.medium + counts.large).toBe(scenario.publicHistory.bets)
    }
  })

  it('prices a public size-conditioned range without using hidden cards', () => {
    const scenario = generateSizedRiverScenarios({
      seed: 'size-evidence',
      count: 1,
      style: 'balanced',
    })[0]
    if (scenario === undefined) throw new Error('missing size scenario')
    const model = trainRiverBetSizeModel('size-evidence-fit', 1_000)
    const sized = enumerateSizedRiverBetEvidence(scenario.observation, model)
    const unsized = enumerateRiverBetEvidence(scenario.observation, model.base)
    if (sized === null || unsized === null) throw new Error('missing river evidence')
    const weights = inferRiverStyleWeights(model.base, scenario.publicHistory)
    expect(sized.combinations).toBe(990)
    expect(unsized.combinations).toBe(990)
    expect(riverShareAfterBet(sized, weights)).toBeGreaterThanOrEqual(0)
    expect(riverShareAfterBet(sized, weights)).toBeLessThanOrEqual(1)
    expect(sized).not.toHaveProperty('opponentHole')
    expect(sized).not.toHaveProperty('style')
    expect(
      enumerateSizedRiverBetEvidence({ ...scenario.observation, actions: [] }, model),
    ).toBeNull()
  })

  it('holds out a bluff-heavy opponent with matched public sizing frequencies', () => {
    const balanced = sampleSizedRiverTrainingExamples('balanced', 'size-match-balanced', 10_000)
    const disguised = sampleSizedRiverTrainingExamples(
      'size-camouflaged',
      'size-match-disguised',
      10_000,
    )
    const betSizes = (rows: typeof balanced) => rows.map((row) => row.size).filter(Boolean)
    const balancedSizes = betSizes(balanced)
    const disguisedSizes = betSizes(disguised)
    expect(Math.abs(balancedSizes.length - disguisedSizes.length) / balanced.length).toBeLessThan(
      0.03,
    )
    for (const size of ['small', 'medium', 'large'] as const) {
      const frequency = (sizes: typeof balancedSizes) =>
        sizes.filter((candidate) => candidate === size).length / sizes.length
      expect(Math.abs(frequency(balancedSizes) - frequency(disguisedSizes))).toBeLessThan(0.04)
    }
  })

  it('holds out a player who reverses the trained bluff and value sizing pattern', () => {
    const rows = sampleSizedRiverTrainingExamples('reverse-sizing', 'reverse-size-check', 10_000)
    const bluffs = rows.filter(
      (row) => row.category === HandCategory.HIGH_CARD && row.size !== null,
    )
    const value = rows.filter((row) => row.category >= HandCategory.TWO_PAIR && row.size !== null)
    expect(bluffs.filter((row) => row.size === 'large').length / bluffs.length).toBeGreaterThan(0.7)
    expect(value.filter((row) => row.size === 'small').length / value.length).toBeGreaterThan(0.7)
  })

  it('updates a style read from prior public size counts without needing prior hidden cards', () => {
    const model = trainRiverBetSizeModel('size-history-fit', 1_000)
    const small = inferRiverStyleWeightsFromSizeHistory(model, {
      opportunities: 24,
      bets: 12,
      sizeCounts: { small: 12, medium: 0, large: 0 },
    })
    const large = inferRiverStyleWeightsFromSizeHistory(model, {
      opportunities: 24,
      bets: 12,
      sizeCounts: { small: 0, medium: 0, large: 12 },
    })
    expect(small.overbluff).toBeGreaterThan(large.overbluff)
    expect(small.value + small.balanced + small.overbluff).toBeCloseTo(1)
    expect(() =>
      inferRiverStyleWeightsFromSizeHistory(model, {
        opportunities: 24,
        bets: 12,
        sizeCounts: { small: 11, medium: 0, large: 0 },
      }),
    ).toThrow('match')
  })
})
