import { personalityPool } from '@river/engine'
import { collectLearningExamples } from './bot-learning-data.js'
import {
  BOT_LEARNING_TUNING,
  calibrateActionModel,
  evaluateActionModel,
  trainActionModel,
} from './bot-learning-model.js'

export const BOT_LEARNING_CAMPAIGN_V1 = {
  version: 1,
  trainingSeed: 'opponent-action-v1-train',
  validationSeed: 'opponent-action-v1-validation',
  testSeed: 'opponent-action-v1-test',
  trainingHands: 800,
  validationHands: 200,
  testHands: 400,
  castIndices: [0, 5, 10, 12],
  minimumLogLossImprovement: 0.02,
  maximumCalibrationRegression: 0,
  minimumRaiseRecall: 0.3,
} as const

export interface LearningCampaignV1 {
  readonly version: 1
  readonly trainingSeed: string
  readonly validationSeed: string
  readonly testSeed: string
  readonly trainingHands: number
  readonly validationHands: number
  readonly testHands: number
  readonly castIndices: readonly number[]
  readonly minimumLogLossImprovement: number
  readonly maximumCalibrationRegression: number
  readonly minimumRaiseRecall: number
}

export function runLearningCampaign(campaign: LearningCampaignV1 = BOT_LEARNING_CAMPAIGN_V1) {
  const cast = personalityPool()
  const seats = campaign.castIndices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('learning campaign cast missing')
    return { personality }
  })
  const training = collectLearningExamples({
    seed: campaign.trainingSeed,
    hands: campaign.trainingHands,
    seats,
  })
  const validation = collectLearningExamples({
    seed: campaign.validationSeed,
    hands: campaign.validationHands,
    seats,
  })
  const test = collectLearningExamples({
    seed: campaign.testSeed,
    hands: campaign.testHands,
    seats,
  })
  const trainingIds = new Set(training.map((row) => row.handId))
  const validationIds = new Set(validation.map((row) => row.handId))
  const testIds = new Set(test.map((row) => row.handId))
  if (
    [...trainingIds].some((id) => validationIds.has(id) || testIds.has(id)) ||
    [...validationIds].some((id) => testIds.has(id))
  ) {
    throw new Error('learning campaign hand groups overlap')
  }
  const model = calibrateActionModel(trainActionModel(training), validation)
  const evaluation = evaluateActionModel(model, training, test)
  const promotionEligible =
    evaluation.logLossImprovement >= campaign.minimumLogLossImprovement &&
    (evaluation.logLossConfidence95?.[0] ?? Number.NEGATIVE_INFINITY) > 0 &&
    evaluation.calibrationImprovement >= campaign.maximumCalibrationRegression &&
    evaluation.learned.accuracy >= evaluation.statistical.accuracy &&
    evaluation.learned.byClass.raise.recall >= campaign.minimumRaiseRecall &&
    evaluation.learned.byClass.raise.recall >= evaluation.statistical.byClass.raise.recall
  return {
    kind: 'river-opponent-action-experiment' as const,
    campaign,
    source: 'seeded River rule-bot hands; no human observations',
    examples: {
      training: training.length,
      validation: validation.length,
      test: test.length,
    },
    tuning: BOT_LEARNING_TUNING,
    evaluation,
    promotionEligible,
    liveInferenceEnabled: false as const,
    model,
  }
}
