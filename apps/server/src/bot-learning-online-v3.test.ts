import { describe, expect, it } from 'vitest'
import type { LearningExampleV1, LearningLabel } from './bot-learning-data.js'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1, predictAction } from './bot-learning-model.js'
import { OnlineActionForecaster, scoreOnlineActionForecaster } from './bot-learning-online-v3.js'

const features = Array(LEARNING_FEATURES_V2.length).fill(0) as number[]
const legal: readonly LearningLabel[] = ['fold', 'call', 'raise']
const weights = ACTION_LABELS.map(() => Array(LEARNING_FEATURES_V2.length + 1).fill(0) as number[])
const frozen: ActionModelV1 = {
  version: 1,
  featureSchemaVersion: 2,
  featureNames: LEARNING_FEATURES_V2,
  labels: ACTION_LABELS,
  weights,
  trainedExamples: 100,
  epochs: 1,
  temperature: 1,
}
const candidate: ActionModelV1 = { ...frozen, calibrationBias: [0, 0, 0, 2] }

function rows(actorId: string, label: LearningLabel, count: number): LearningExampleV1[] {
  return Array.from({ length: count }, (_, index) => ({
    actorId,
    handId: `${actorId}-${index}`,
    features,
    legalLabels: legal,
    label,
  }))
}

describe('offline causal online forecast gate', () => {
  it('starts from the frozen model, adapts to prior actions and isolates actors', () => {
    const forecaster = new OnlineActionForecaster(frozen, candidate)
    const initial = forecaster.forecast('raiser', features, legal)
    expect(initial.candidateWeight).toBe(0)
    expect(initial.probabilities).toEqual(predictAction(frozen, features, legal))
    for (let action = 0; action < 16; action += 1) {
      const forecast = forecaster.forecast('raiser', features, legal)
      forecaster.observe(forecast, 'raise')
    }
    const adapted = forecaster.forecast('raiser', features, legal)
    expect(adapted.candidateWeight).toBeGreaterThan(0)
    expect(adapted.probabilities.raise).toBeGreaterThan(initial.probabilities.raise)
    expect(forecaster.forecast('new-person', features, legal).probabilities).toEqual(
      initial.probabilities,
    )
    expect(Object.values(adapted.probabilities).reduce((sum, value) => sum + value, 0)).toBeCloseTo(
      1,
    )
    expect(adapted.probabilities.check).toBe(0)
    for (let action = 0; action < 24; action += 1) {
      const forecast = forecaster.forecast('raiser', features, legal)
      forecaster.observe(forecast, 'fold')
    }
    expect(forecaster.forecast('raiser', features, legal).candidateWeight).toBe(0)
  })

  it('rejects illegal labels and leaves ordinary actors on the frozen model', () => {
    const forecaster = new OnlineActionForecaster(frozen, candidate)
    expect(() =>
      forecaster.observe(forecaster.forecast('person', features, legal), 'check'),
    ).toThrow('legal')
    const accepted = forecaster.forecast('person', features, legal)
    forecaster.observe(accepted, 'fold')
    expect(() => forecaster.observe(accepted, 'fold')).toThrow('already observed')
    const ordinary = rows('ordinary', 'fold', 20)
    const result = scoreOnlineActionForecaster(frozen, candidate, ordinary)
    expect(result.adaptedForecasts).toBe(0)
    expect(result.metrics.logLoss).toBeCloseTo(Math.log(3), 10)
  })

  it('improves a repeated raised-action sequence without observing its future labels', () => {
    const unusual = rows('unusual', 'raise', 25)
    const result = scoreOnlineActionForecaster(frozen, candidate, unusual)
    expect(result.adaptedForecasts).toBeGreaterThan(0)
    expect(result.metrics.logLoss).toBeLessThan(Math.log(3))
  })
})
