import { HandCategory, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  inferRiverStyleWeightsWithReveals,
  riverShareAfterBet,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import { generateRiverBettingScenarios } from './bot-river-scenarios.js'

describe('offline action-conditioned river model', () => {
  it('learns reproducible action rates and updates only from prior public bet/check counts', () => {
    const model = trainRiverBetRateModel('river-rate-train', 1_000)
    expect(trainRiverBetRateModel('river-rate-train', 1_000)).toEqual(model)
    expect(model.betRates.value).toBeLessThan(model.betRates.balanced)
    expect(model.betRates.balanced).toBeLessThan(model.betRates.overbluff)
    expect(model.likelihoodByBucket.value.highCard).toBeLessThan(
      model.likelihoodByBucket.balanced.highCard,
    )
    expect(model.likelihoodByBucket.balanced.highCard).toBeLessThan(
      model.likelihoodByBucket.overbluff.highCard,
    )
    expect(inferRiverStyleWeights(model, { opportunities: 0, bets: 0 })).toEqual({
      value: 1 / 3,
      balanced: 1 / 3,
      overbluff: 1 / 3,
    })
    expect(inferRiverStyleWeights(model, { opportunities: 24, bets: 4 }).value).toBeGreaterThan(
      inferRiverStyleWeights(model, { opportunities: 24, bets: 19 }).value,
    )
    expect(
      inferRiverStyleWeights(model, { opportunities: 24, bets: 19 }).overbluff,
    ).toBeGreaterThan(inferRiverStyleWeights(model, { opportunities: 24, bets: 4 }).overbluff)
    expect(() => inferRiverStyleWeights(model, { opportunities: 2, bets: 3 })).toThrow('valid')
    expect(inferRiverStyleWeightsWithReveals(model, { opportunities: 24, bets: 10 })).toEqual(
      inferRiverStyleWeights(model, { opportunities: 24, bets: 10 }),
    )
    const exposedBluff = inferRiverStyleWeightsWithReveals(model, {
      opportunities: 24,
      bets: 10,
      revealedBetCategories: [HandCategory.HIGH_CARD],
    })
    expect(exposedBluff.value).toBeLessThan(
      inferRiverStyleWeights(model, { opportunities: 24, bets: 10 }).value,
    )
    expect(() =>
      inferRiverStyleWeightsWithReveals(model, {
        opportunities: 1,
        bets: 0,
        revealedBetCategories: [HandCategory.HIGH_CARD],
      }),
    ).toThrow('exceed')
  })

  it('enumerates public-card-blocked hands and conditions equity on the observed bet', () => {
    const scenario = generateRiverBettingScenarios({
      seed: 'river-conditional-evidence',
      count: 1,
      style: 'balanced',
    })[0]
    if (scenario === undefined) throw new Error('scenario missing')
    const evidence = enumerateRiverBetEvidence(
      {
        ...scenario.observation,
        actor: { ...scenario.observation.actor, hole: ['As', 'Kd'].map(parseCard) },
        board: ['2c', '4h', '6d', '8s', 'Jc'].map(parseCard),
      },
      trainRiverBetRateModel('river-evidence-train', 1_000),
    )
    if (evidence === null) throw new Error('river evidence missing')
    expect(evidence.combinations).toBe(990)
    expect(evidence.byStyle.value.betMass).toBeLessThan(evidence.byStyle.balanced.betMass)
    expect(evidence.byStyle.balanced.betMass).toBeLessThan(evidence.byStyle.overbluff.betMass)
    const value = riverShareAfterBet(evidence, { value: 1, balanced: 0, overbluff: 0 })
    const overbluff = riverShareAfterBet(evidence, { value: 0, balanced: 0, overbluff: 1 })
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(1)
    expect(overbluff).toBeGreaterThanOrEqual(0)
    expect(overbluff).toBeLessThanOrEqual(1)
    expect(evidence).not.toHaveProperty('opponentHole')
    expect(evidence).not.toHaveProperty('style')
  })

  it('fails closed on unsupported or impossible public observations', () => {
    const scenario = generateRiverBettingScenarios({
      seed: 'river-unsupported',
      count: 1,
      style: 'value',
    })[0]
    if (scenario === undefined) throw new Error('scenario missing')
    const observation = scenario.observation
    const model = trainRiverBetRateModel('river-unsupported-model', 100)
    const firstHole = observation.actor.hole[0]
    if (firstHole === undefined) throw new Error('actor hole missing')
    expect(enumerateRiverBetEvidence({ ...observation, street: 'turn' }, model)).toBeNull()
    expect(
      enumerateRiverBetEvidence(
        {
          ...observation,
          board: [firstHole, ...observation.board.slice(1)],
        },
        model,
      ),
    ).toBeNull()
    const { actions: _actions, ...withoutActions } = observation
    expect(enumerateRiverBetEvidence(withoutActions, model)).toBeNull()
    expect(enumerateRiverBetEvidence({ ...observation, actions: [] }, model)).toBeNull()
    expect(
      enumerateRiverBetEvidence(
        {
          ...observation,
          actions: (observation.actions ?? []).map((action) => ({
            ...action,
            seat: observation.actor.seat,
          })),
        },
        model,
      ),
    ).toBeNull()
    expect(enumerateRiverBetEvidence({ ...observation, currentBet: 100 }, model)).toBeNull()
  })
})
