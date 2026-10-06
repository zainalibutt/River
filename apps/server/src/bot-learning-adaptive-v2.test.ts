import { describe, expect, it } from 'vitest'
import { predictAdaptiveActionV2 } from './bot-learning-adaptive-v2.js'
import { ACTOR_HISTORY_COUNT_SCALE_V2, LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1, predictAction } from './bot-learning-model.js'

const weights = ACTION_LABELS.map(() => Array<number>(LEARNING_FEATURES_V2.length + 1).fill(0))
const model: ActionModelV1 = {
  version: 1,
  featureSchemaVersion: 2,
  featureNames: [...LEARNING_FEATURES_V2],
  labels: [...ACTION_LABELS],
  weights,
  trainedExamples: 1,
  epochs: 1,
  temperature: 1,
}

function row(facing: boolean, samples: number, raises: number) {
  const features = Array<number>(LEARNING_FEATURES_V2.length).fill(0)
  const prefix = facing ? 'actor_facing_bet_' : 'actor_free_action_'
  const countName = facing ? 'actor_facing_bet_sample_count' : 'actor_free_action_sample_count'
  features[LEARNING_FEATURES_V2.indexOf('facing_bet')] = Number(facing)
  features[LEARNING_FEATURES_V2.indexOf(countName)] =
    samples / (samples + ACTOR_HISTORY_COUNT_SCALE_V2)
  const labels = facing
    ? (['fold', 'call', 'raise'] as const)
    : (['fold', 'check', 'raise'] as const)
  for (const label of labels) {
    const observed = label === 'raise' ? raises : label === labels[1] ? samples - raises : 0
    features[LEARNING_FEATURES_V2.indexOf(`${prefix}${label}_smoothed_rate`)] =
      (observed + 1) / (samples + 3)
  }
  return {
    features,
    label: 'raise' as const,
    legalLabels: facing ? (['fold', 'call', 'raise'] as const) : (['check', 'raise'] as const),
    handId: 'adaptive-test-hand',
    actorId: 'adaptive-test-actor',
  }
}

describe('causal actor-history forecast', () => {
  it('leaves a cold actor at the frozen model forecast', () => {
    const example = row(false, 0, 0)
    expect(predictAdaptiveActionV2(model, example, 12)).toEqual(
      predictAction(model, example.features, example.legalLabels),
    )
  })

  it('responds to prior pressure without assigning illegal-action probability', () => {
    const example = row(false, 40, 40)
    const probabilities = predictAdaptiveActionV2(model, example, 12)
    expect(probabilities.raise).toBeGreaterThan(0.8)
    expect(probabilities.fold).toBe(0)
    expect(probabilities.call).toBe(0)
    expect(probabilities.check + probabilities.raise).toBeCloseTo(1)
  })

  it('uses the facing-bet history separately', () => {
    const example = row(true, 20, 0)
    const probabilities = predictAdaptiveActionV2(model, example, 12)
    expect(probabilities.call).toBeGreaterThan(probabilities.raise)
    expect(probabilities.check).toBe(0)
  })

  it('rejects invalid priors and saturated counts', () => {
    const example = row(false, 10, 5)
    expect(() => predictAdaptiveActionV2(model, example, 0)).toThrow('prior')
    example.features[LEARNING_FEATURES_V2.indexOf('actor_free_action_sample_count')] = 1
    expect(() => predictAdaptiveActionV2(model, example, 12)).toThrow('sample count')
  })
})
