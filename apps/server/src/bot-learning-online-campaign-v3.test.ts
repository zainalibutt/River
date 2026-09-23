import { personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { trainContextualActionModel } from './bot-learning-model.js'
import {
  BOT_LEARNING_ONLINE_CAMPAIGN_V3,
  runOnlineForecastCampaignV3,
} from './bot-learning-online-campaign-v3.js'

const cast = personalityPool()
const training = collectLearningExamplesV2({
  seed: 'online-campaign-test-frozen',
  hands: 10,
  seats: cast.slice(0, 4).map((personality) => ({ personality })),
})
const frozen = trainContextualActionModel(training, { epochs: 10, learningRate: 0.35, l2: 0.002 })
const candidate = { ...frozen, calibrationBias: [0, 0, 0, 0.2] }
const small = {
  ...BOT_LEARNING_ONLINE_CAMPAIGN_V3,
  selectionHands: 5,
  baseConfirmationHands: 5,
  styleConfirmationHands: 5,
  novelConfirmationHands: 5,
  tableConfirmationHands: 5,
}

describe('causal online opponent-forecast campaign', () => {
  it('keeps gate selection and confirmation seeded separately without live inference', () => {
    const result = runOnlineForecastCampaignV3(frozen, candidate, small)
    expect(result.selection.considered).toBe(9)
    expect(result.baseTests).toHaveLength(2)
    expect(result.liveInferenceEnabled).toBe(false)
    expect(runOnlineForecastCampaignV3(frozen, candidate, small)).toEqual(result)
  })

  it('rejects reused training, selection or confirmation seeds', () => {
    expect(() =>
      runOnlineForecastCampaignV3(frozen, candidate, {
        ...small,
        baseSelectionSeed: 'opponent-action-v3-base-train',
      }),
    ).toThrow('seed reuse')
    expect(() =>
      runOnlineForecastCampaignV3(frozen, candidate, {
        ...small,
        novelConfirmationSeed: small.baseSelectionSeed,
      }),
    ).toThrow('seed reuse')
    expect(() =>
      runOnlineForecastCampaignV3(frozen, candidate, {
        ...small,
        baseConfirmationSeeds: ['only-one'],
      }),
    ).toThrow('two base confirmation seeds')
  })
})
