import { describe, expect, it } from 'vitest'
import { BOT_LEARNING_CAMPAIGN_V2, runLearningCampaignV2 } from './bot-learning-campaign-v2.js'

describe('version-two opponent-action campaign', () => {
  it('trains a schema-two model with distinct hand seeds', () => {
    const small = {
      ...BOT_LEARNING_CAMPAIGN_V2,
      trainingHands: 12,
      validationHands: 5,
      testHandsPerSeed: 5,
      confirmationHandsPerSeed: 5,
      unseenHands: 5,
      trainingEpochs: 12,
    }
    const result = runLearningCampaignV2(small)
    expect(result.model.featureSchemaVersion).toBe(2)
    expect(result.examples.training).toBeGreaterThan(0)
    expect(result.testResults).toHaveLength(3)
    expect(result.confirmationResults).toHaveLength(3)
    expect(result.unseenResult.evaluation.learned.count).toBeGreaterThan(0)
    expect(result.liveInferenceEnabled).toBe(false)
    expect(runLearningCampaignV2(small)).toEqual(result)
  })

  it('refuses reused training or held-out seeds', () => {
    expect(() =>
      runLearningCampaignV2({
        ...BOT_LEARNING_CAMPAIGN_V2,
        testSeeds: [BOT_LEARNING_CAMPAIGN_V2.trainingSeed],
      }),
    ).toThrow('seed reuse')
  })
})
