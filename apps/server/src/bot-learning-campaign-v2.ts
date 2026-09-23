import { personalityPool } from '@river/engine'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import {
  BOT_LEARNING_TUNING,
  calibrateActionModel,
  evaluateActionModel,
  trainContextualActionModel,
} from './bot-learning-model.js'

export const BOT_LEARNING_CAMPAIGN_V2 = {
  version: 2,
  trainingSeed: 'opponent-action-v2-train',
  validationSeed: 'opponent-action-v2-validation',
  testSeeds: [
    'opponent-action-v2-test-a',
    'opponent-action-v2-test-b',
    'opponent-action-v2-test-c',
  ],
  confirmationSeeds: [
    'opponent-action-v2-confirm-a',
    'opponent-action-v2-confirm-b',
    'opponent-action-v2-confirm-c',
  ],
  unseenSeed: 'opponent-action-v2-unseen-cast',
  trainingHands: 1_000,
  validationHands: 250,
  testHandsPerSeed: 350,
  confirmationHandsPerSeed: 350,
  unseenHands: 400,
  castIndices: [0, 5, 10, 12],
  unseenCastIndices: [2, 7, 9, 11],
  trainingEpochs: 600,
  minimumLogLossImprovement: 0.02,
  maximumCalibrationRegression: 0,
  minimumRaiseRecall: 0.3,
} as const

export interface LearningCampaignV2 {
  readonly version: 2
  readonly trainingSeed: string
  readonly validationSeed: string
  readonly testSeeds: readonly string[]
  readonly confirmationSeeds: readonly string[]
  readonly unseenSeed: string
  readonly trainingHands: number
  readonly validationHands: number
  readonly testHandsPerSeed: number
  readonly confirmationHandsPerSeed: number
  readonly unseenHands: number
  readonly castIndices: readonly number[]
  readonly unseenCastIndices: readonly number[]
  readonly trainingEpochs: number
  readonly minimumLogLossImprovement: number
  readonly maximumCalibrationRegression: number
  readonly minimumRaiseRecall: number
}

export function runLearningCampaignV2(campaign: LearningCampaignV2 = BOT_LEARNING_CAMPAIGN_V2) {
  const cast = personalityPool()
  const seats = campaign.castIndices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('learning campaign cast missing')
    return { personality }
  })
  const unseenSeats = campaign.unseenCastIndices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('unseen learning campaign cast missing')
    return { personality }
  })
  if (campaign.unseenCastIndices.some((index) => campaign.castIndices.includes(index))) {
    throw new Error('unseen learning campaign cast overlaps training')
  }
  const seeds = [
    campaign.trainingSeed,
    campaign.validationSeed,
    ...campaign.testSeeds,
    ...campaign.confirmationSeeds,
    campaign.unseenSeed,
  ]
  if (new Set(seeds).size !== seeds.length) throw new Error('learning campaign seed reuse')
  if (campaign.testSeeds.length === 0 || campaign.confirmationSeeds.length === 0) {
    throw new Error('learning campaign needs held-out seeds')
  }
  const training = collectLearningExamplesV2({
    seed: campaign.trainingSeed,
    hands: campaign.trainingHands,
    seats,
  })
  const validation = collectLearningExamplesV2({
    seed: campaign.validationSeed,
    hands: campaign.validationHands,
    seats,
  })
  const model = calibrateActionModel(
    trainContextualActionModel(training, {
      epochs: campaign.trainingEpochs,
      learningRate: BOT_LEARNING_TUNING.learningRate,
      l2: BOT_LEARNING_TUNING.l2,
    }),
    validation,
  )
  const testResults = campaign.testSeeds.map((seed) => {
    const heldOut = collectLearningExamplesV2({
      seed,
      hands: campaign.testHandsPerSeed,
      seats,
    })
    return { seed, evaluation: evaluateActionModel(model, training, heldOut) }
  })
  const confirmationResults = campaign.confirmationSeeds.map((seed) => {
    const heldOut = collectLearningExamplesV2({
      seed,
      hands: campaign.confirmationHandsPerSeed,
      seats,
    })
    return { seed, evaluation: evaluateActionModel(model, training, heldOut) }
  })
  const unseenExamples = collectLearningExamplesV2({
    seed: campaign.unseenSeed,
    hands: campaign.unseenHands,
    seats: unseenSeats,
  })
  const unseenResult = {
    seed: campaign.unseenSeed,
    evaluation: evaluateActionModel(model, training, unseenExamples),
  }
  const promotionEligible = [...confirmationResults, unseenResult].every(
    ({ evaluation }) =>
      evaluation.logLossImprovement >= campaign.minimumLogLossImprovement &&
      (evaluation.logLossConfidence95?.[0] ?? Number.NEGATIVE_INFINITY) > 0 &&
      evaluation.calibrationImprovement >= campaign.maximumCalibrationRegression &&
      evaluation.learned.accuracy >= evaluation.statistical.accuracy &&
      evaluation.learned.byClass.raise.recall >= campaign.minimumRaiseRecall &&
      evaluation.learned.byClass.raise.recall >= evaluation.statistical.byClass.raise.recall,
  )
  return {
    kind: 'river-opponent-action-experiment' as const,
    campaign,
    source:
      'seeded River rule-bot hands; causal public actor-action history; no human observations',
    examples: {
      training: training.length,
      validation: validation.length,
      tests: testResults.map(({ seed, evaluation }) => ({ seed, count: evaluation.learned.count })),
      confirmation: confirmationResults.map(({ seed, evaluation }) => ({
        seed,
        count: evaluation.learned.count,
      })),
      unseen: unseenExamples.length,
    },
    tuning: BOT_LEARNING_TUNING,
    testResults,
    confirmationResults,
    unseenResult,
    promotionEligible,
    liveInferenceEnabled: false as const,
    model,
  }
}
