import { personalityPool } from '@river/engine'
import type { BenchmarkSeat } from './bot-benchmark.js'
import type { LearningExampleV1 } from './bot-learning-data.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import {
  type ActionModelV1,
  BOT_LEARNING_TUNING,
  calibrateActionModel,
  evaluateActionModel,
  predictAction,
  trainContextualActionModel,
} from './bot-learning-model.js'
import { authoredNovelSeats, NOVEL_STYLES } from './bot-learning-novel-v3.js'
import { authoredShiftSeats } from './bot-learning-shift-v2.js'
import { botPlayerId } from './bot-service.js'

export const BOT_LEARNING_CAMPAIGN_V3 = {
  baseTrainingSeed: 'opponent-action-v3-base-train',
  styleTrainingSeed: 'opponent-action-v3-style-train',
  baseValidationSeed: 'opponent-action-v3-base-validation',
  styleValidationSeed: 'opponent-action-v3-style-validation',
  baseTestSeeds: ['opponent-action-v3-base-test-a', 'opponent-action-v3-base-test-b'],
  knownStyleTestSeed: 'opponent-action-v3-known-style-test',
  novelStyleTestSeed: 'opponent-action-v3-novel-style-confirm',
  eightSeatTestSeed: 'opponent-action-v3-eight-seat-confirm',
  nineSeatTestSeed: 'opponent-action-v3-nine-seat-confirm',
  baseTrainingHands: 600,
  styleTrainingHands: 500,
  baseValidationHands: 150,
  styleValidationHands: 125,
  baseTestHands: 250,
  knownStyleTestHands: 300,
  novelStyleTestHands: 400,
  eightSeatTestHands: 300,
  nineSeatTestHands: 300,
  trainingEpochs: 350,
  trainingCastIndices: [0, 5, 10, 12],
  novelCastIndices: [2, 7, 9, 11],
  nineSeatCastIndex: 6,
} as const

export type LearningCampaignV3 = {
  readonly [K in keyof typeof BOT_LEARNING_CAMPAIGN_V3]: (typeof BOT_LEARNING_CAMPAIGN_V3)[K] extends readonly number[]
    ? readonly number[]
    : (typeof BOT_LEARNING_CAMPAIGN_V3)[K] extends readonly string[]
      ? readonly string[]
      : (typeof BOT_LEARNING_CAMPAIGN_V3)[K] extends number
        ? number
        : string
}

export function runLearningCampaignV3(
  frozen: ActionModelV1,
  campaign: LearningCampaignV3 = BOT_LEARNING_CAMPAIGN_V3,
) {
  const allSeeds = [
    campaign.baseTrainingSeed,
    campaign.styleTrainingSeed,
    campaign.baseValidationSeed,
    campaign.styleValidationSeed,
    ...campaign.baseTestSeeds,
    campaign.knownStyleTestSeed,
    campaign.novelStyleTestSeed,
    campaign.eightSeatTestSeed,
    campaign.nineSeatTestSeed,
  ]
  if (new Set(allSeeds).size !== allSeeds.length) throw new Error('v3 campaign seed reuse')
  if (campaign.baseTestSeeds.length === 0) throw new Error('v3 campaign needs base test seeds')
  if (campaign.novelCastIndices.some((index) => campaign.trainingCastIndices.includes(index))) {
    throw new Error('v3 campaign novel cast overlaps training')
  }
  if (
    [...campaign.trainingCastIndices, ...campaign.novelCastIndices].includes(
      campaign.nineSeatCastIndex,
    )
  ) {
    throw new Error('v3 nine-seat cast duplicates another identity')
  }
  const cast = personalityPool()
  const baseSeats = campaign.trainingCastIndices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('v3 campaign cast missing')
    return { personality }
  })
  const styleSeats = authoredShiftSeats(campaign.trainingCastIndices)
  const novelSeats = authoredNovelSeats(campaign.novelCastIndices)
  const ninthPersonality = cast[campaign.nineSeatCastIndex]
  if (ninthPersonality === undefined) throw new Error('v3 nine-seat cast missing')
  const collect = (seed: string, hands: number, seats: readonly BenchmarkSeat[]) =>
    collectLearningExamplesV2({ seed, hands, seats })
  const training: readonly LearningExampleV1[] = [
    ...collect(campaign.baseTrainingSeed, campaign.baseTrainingHands, baseSeats),
    ...collect(campaign.styleTrainingSeed, campaign.styleTrainingHands, styleSeats),
  ]
  const validation: readonly LearningExampleV1[] = [
    ...collect(campaign.baseValidationSeed, campaign.baseValidationHands, baseSeats),
    ...collect(campaign.styleValidationSeed, campaign.styleValidationHands, styleSeats),
  ]
  const candidate = calibrateActionModel(
    trainContextualActionModel(training, {
      epochs: campaign.trainingEpochs,
      learningRate: BOT_LEARNING_TUNING.learningRate,
      l2: BOT_LEARNING_TUNING.l2,
    }),
    validation,
  )
  const compare = (examples: readonly LearningExampleV1[]) => ({
    candidate: evaluateActionModel(candidate, training, examples),
    frozen: evaluateActionModel(frozen, training, examples),
    pairedLogLoss: pairedLogLoss(candidate, frozen, examples),
  })
  const baseTests = campaign.baseTestSeeds.map((seed) => ({
    seed,
    ...compare(collect(seed, campaign.baseTestHands, baseSeats)),
  }))
  const knownStyleTest = compare(
    collect(campaign.knownStyleTestSeed, campaign.knownStyleTestHands, styleSeats),
  )
  const novelExamples = collect(
    campaign.novelStyleTestSeed,
    campaign.novelStyleTestHands,
    novelSeats,
  )
  const novelStyleTest = compare(novelExamples)
  const eightSeatTest = compare(
    collect(campaign.eightSeatTestSeed, campaign.eightSeatTestHands, [...baseSeats, ...novelSeats]),
  )
  const nineSeatTest = compare(
    collect(campaign.nineSeatTestSeed, campaign.nineSeatTestHands, [
      ...baseSeats,
      ...novelSeats,
      { personality: ninthPersonality },
    ]),
  )
  const novelByStyle = novelSeats.map((seat, index) => {
    const style = NOVEL_STYLES[index]
    if (style === undefined) throw new Error('v3 novel style missing')
    const examples = novelExamples.filter(
      (example) => example.actorId === botPlayerId(seat.personality.id),
    )
    return { style, count: examples.length, ...compare(examples) }
  })
  const beatsFrozen = [
    ...baseTests,
    knownStyleTest,
    novelStyleTest,
    eightSeatTest,
    nineSeatTest,
  ].every((test) => test.candidate.learned.logLoss < test.frozen.learned.logLoss)
  const clearsCalibration = [...baseTests, novelStyleTest, eightSeatTest, nineSeatTest].every(
    (test) => test.candidate.learned.calibrationError <= test.frozen.learned.calibrationError,
  )
  const clearsRaiseRecall =
    novelStyleTest.candidate.learned.byClass.raise.recall >=
    novelStyleTest.frozen.learned.byClass.raise.recall
  const confidentImprovement = [...baseTests, novelStyleTest, eightSeatTest, nineSeatTest].every(
    (test) => (test.pairedLogLoss.confidence95?.[0] ?? Number.NEGATIVE_INFINITY) > 0,
  )
  return {
    kind: 'river-opponent-action-v3-experiment' as const,
    source: 'seeded legal synthetic bot actions; no human hands or live inference',
    campaign,
    counts: {
      training: training.length,
      validation: validation.length,
      novel: novelExamples.length,
    },
    baseTests,
    knownStyleTest,
    novelStyleTest,
    eightSeatTest,
    nineSeatTest,
    novelByStyle,
    checks: { beatsFrozen, clearsCalibration, clearsRaiseRecall, confidentImprovement },
    promotionEligible:
      beatsFrozen && clearsCalibration && clearsRaiseRecall && confidentImprovement,
    liveInferenceEnabled: false as const,
    candidate,
  }
}

function pairedLogLoss(
  candidate: ActionModelV1,
  frozen: ActionModelV1,
  examples: readonly LearningExampleV1[],
) {
  const byHand = new Map<string, { sum: number; count: number }>()
  let sum = 0
  for (const example of examples) {
    const improvement =
      Math.log(
        Math.max(
          BOT_LEARNING_TUNING.probabilityFloor,
          predictAction(candidate, example.features, example.legalLabels)[example.label],
        ),
      ) -
      Math.log(
        Math.max(
          BOT_LEARNING_TUNING.probabilityFloor,
          predictAction(frozen, example.features, example.legalLabels)[example.label],
        ),
      )
    sum += improvement
    const hand = byHand.get(example.handId) ?? { sum: 0, count: 0 }
    hand.sum += improvement
    hand.count += 1
    byHand.set(example.handId, hand)
  }
  const improvement = sum / examples.length
  const hands = [...byHand.values()]
  const squaredInfluence = hands.reduce(
    (total, hand) => total + (hand.sum - improvement * hand.count) ** 2,
    0,
  )
  const radius =
    hands.length < 2
      ? null
      : (1.96 * Math.sqrt((hands.length / (hands.length - 1)) * squaredInfluence)) / examples.length
  return {
    improvement,
    confidence95: radius === null ? null : ([improvement - radius, improvement + radius] as const),
    hands: hands.length,
  }
}
