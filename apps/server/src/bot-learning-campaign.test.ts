import { describe, expect, it } from 'vitest'
import { BOT_LEARNING_CAMPAIGN_V1, runLearningCampaign } from './bot-learning-campaign.js'

describe('reproducible bot-learning campaign', () => {
  it('keeps training, calibration and test hands separate', () => {
    const small = {
      ...BOT_LEARNING_CAMPAIGN_V1,
      trainingHands: 8,
      validationHands: 4,
      testHands: 4,
    }
    const first = runLearningCampaign(small)
    expect(runLearningCampaign(small)).toEqual(first)
    expect(first.examples.training).toBeGreaterThan(0)
    expect(first.examples.validation).toBeGreaterThan(0)
    expect(first.examples.test).toBeGreaterThan(0)
    expect(first.source).toContain('no human observations')
    expect(first.liveInferenceEnabled).toBe(false)
    expect(first.model.trainedExamples).toBe(first.examples.training)
    expect(first.evaluation.learned.byClass.raise.count).toBeGreaterThanOrEqual(0)
  })

  it('refuses reused seeds across campaign partitions', () => {
    expect(() =>
      runLearningCampaign({
        ...BOT_LEARNING_CAMPAIGN_V1,
        trainingHands: 2,
        validationHands: 2,
        testHands: 2,
        testSeed: BOT_LEARNING_CAMPAIGN_V1.trainingSeed,
      }),
    ).toThrow('overlap')
  })
})
