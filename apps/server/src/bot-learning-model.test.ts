import { describe, expect, it } from 'vitest'
import { LEARNING_FEATURES_V1, type LearningExampleV1 } from './bot-learning-data.js'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import {
  calibrateActionModel,
  evaluateActionModel,
  predictAction,
  trainActionModel,
  trainContextualActionModel,
  validateModel,
} from './bot-learning-model.js'

const legal = ['fold', 'call', 'raise'] as const

function example(hand: string, signal: number): LearningExampleV1 {
  return {
    handId: hand,
    actorId: 'public-opponent',
    features: LEARNING_FEATURES_V1.map((_, index) => (index === 0 ? signal : 0)),
    label: signal === 0 ? 'fold' : 'raise',
    legalLabels: legal,
  }
}

describe('offline learned opponent-action predictor', () => {
  it('trains deterministically and improves held-out log loss on a public signal', () => {
    const training = Array.from({ length: 80 }, (_, index) => example(`train:${index}`, index % 2))
    const heldOut = Array.from({ length: 20 }, (_, index) => example(`held:${index}`, index % 2))
    const first = trainActionModel(training)
    expect(trainActionModel(training)).toEqual(first)
    expect(calibrateActionModel(first, heldOut)).toEqual(calibrateActionModel(first, heldOut))
    const evaluation = evaluateActionModel(first, training, heldOut)
    expect(evaluation.learned.count).toBe(20)
    expect(evaluation.logLossImprovement).toBeGreaterThan(0)
    expect(evaluation.logLossConfidence95?.[0]).toBeLessThan(evaluation.logLossImprovement)
    expect(evaluation.logLossConfidence95?.[1]).toBeGreaterThan(evaluation.logLossImprovement)
    expect(evaluation.learned.accuracy).toBe(1)
    expect(predictAction(first, heldOut[0]?.features ?? [], legal).check).toBe(0)
    expect(predictAction(first, heldOut[0]?.features ?? [], legal).call).toBeGreaterThanOrEqual(0)
  })

  it('rejects train-test hand overlap and invalid labels or features', () => {
    const training = [example('same', 0)]
    const model = trainActionModel(training)
    expect(() => evaluateActionModel(model, training, training)).toThrow('overlap')
    expect(
      evaluateActionModel(model, training, [example('other', 1)]).logLossConfidence95,
    ).toBeNull()
    expect(() =>
      trainActionModel([{ ...training[0], label: 'check' } as LearningExampleV1]),
    ).toThrow('label must be legal')
    expect(() => predictAction(model, [Number.NaN], legal)).toThrow('invalid action features')
    expect(() =>
      predictAction(
        model,
        LEARNING_FEATURES_V1.map(() => 1.01),
        legal,
      ),
    ).toThrow('invalid action features')
  })

  it('refuses an incompatible exported feature schema or non-finite weights', () => {
    const model = trainActionModel([example('a', 0), example('b', 1)])
    expect(() => validateModel(null)).toThrow('incompatible')
    expect(() => validateModel({ ...model, contextWeights: null })).toThrow('incompatible')
    expect(() => validateModel({ ...model, featureNames: ['leaked_private_card'] })).toThrow(
      'incompatible',
    )
    const weights = model.weights.map((row) => [...row])
    if (weights[0] === undefined) throw new Error('missing model row')
    weights[0][0] = Number.POSITIVE_INFINITY
    expect(() => validateModel({ ...model, weights })).toThrow('incompatible')
    expect(() => validateModel({ ...model, temperature: 0 })).toThrow('incompatible')
  })

  it('keeps version-one and version-two feature contracts separate', () => {
    const training = [example('a', 0), example('b', 1)].map((row) => ({
      ...row,
      features: [
        ...row.features,
        ...LEARNING_FEATURES_V2.slice(LEARNING_FEATURES_V1.length).map(() => 0),
      ],
    }))
    const model = trainActionModel(training, { epochs: 2, learningRate: 0.35, l2: 0.002 }, 2)
    expect(model.featureSchemaVersion).toBe(2)
    expect(model.featureNames).toEqual(LEARNING_FEATURES_V2)
    expect(() => predictAction(model, training[0]?.features ?? [], legal)).not.toThrow()
    expect(() => predictAction(model, example('c', 0).features, legal)).toThrow(
      'invalid action features',
    )
    expect(() => validateModel({ ...model, featureSchemaVersion: 1 })).toThrow('incompatible')
  })

  it('uses distinct context heads without changing legal-action masking', () => {
    const facingIndex = LEARNING_FEATURES_V2.indexOf('facing_bet')
    const rows = Array.from({ length: 10 }, (_, index) => {
      const features = LEARNING_FEATURES_V2.map(() => 0)
      features[facingIndex] = index % 2
      return {
        handId: `context:${index}`,
        actorId: 'public-opponent',
        features,
        label: index % 2 === 0 ? ('check' as const) : ('raise' as const),
        legalLabels: index % 2 === 0 ? (['check', 'raise'] as const) : legal,
      }
    })
    const model = trainContextualActionModel(rows, { epochs: 20, learningRate: 0.35, l2: 0.002 })
    expect(model.contextWeights?.facing).not.toEqual(model.contextWeights?.free)
    expect(predictAction(model, rows[0]?.features ?? [], ['check', 'raise']).fold).toBe(0)
    expect(predictAction(model, rows[1]?.features ?? [], legal).check).toBe(0)
    expect(() => validateModel({ ...model, featureSchemaVersion: 1 })).toThrow('incompatible')
  })
})
