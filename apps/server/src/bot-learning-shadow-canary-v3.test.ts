import { describe, expect, it } from 'vitest'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1 } from './bot-learning-model.js'
import { ONLINE_FORECAST_TUNING_V3 } from './bot-learning-online-v3.js'
import { runSyntheticShadowCanaryV3 } from './bot-learning-shadow-canary-v3.js'

const model: ActionModelV1 = {
  version: 1,
  featureSchemaVersion: 2,
  featureNames: LEARNING_FEATURES_V2,
  labels: ACTION_LABELS,
  weights: ACTION_LABELS.map(() => Array(LEARNING_FEATURES_V2.length + 1).fill(0) as number[]),
  trainedExamples: 100,
  epochs: 1,
  temperature: 1,
}

describe('nine-seat synthetic shadow canary', () => {
  it('replays accepted nine-seat actions without dropping a forecast', async () => {
    const result = await runSyntheticShadowCanaryV3(model, model, ONLINE_FORECAST_TUNING_V3, {
      seed: 'shadow-nine-seat-test',
      hands: 3,
    })
    expect(result.seats).toBe(9)
    expect(result.accepted).toBeGreaterThan(0)
    expect(result.stats.forecasts).toBe(result.accepted)
    expect(result.stats.dropped).toBe(0)
    expect(result.stats.failed).toBe(0)
    expect(result.maxPending).toBeGreaterThan(0)
    expect(result.stats.captureP95Ms).toBeGreaterThanOrEqual(0)
    expect(result.stats.inferenceP95Ms).toBeGreaterThanOrEqual(0)
  })

  it('refuses an unbounded campaign', async () => {
    await expect(
      runSyntheticShadowCanaryV3(model, model, ONLINE_FORECAST_TUNING_V3, {
        seed: 'too-many',
        hands: 501,
      }),
    ).rejects.toThrow('1 to 500')
  })
})
