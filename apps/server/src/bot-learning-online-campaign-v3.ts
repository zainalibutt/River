import { personalityPool } from '@river/engine'
import type { BenchmarkSeat } from './bot-benchmark.js'
import { BOT_LEARNING_CAMPAIGN_V3 } from './bot-learning-campaign-v3.js'
import type { LearningExampleV1 } from './bot-learning-data.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { type ActionModelV1, predictAction, scoreActionPredictions } from './bot-learning-model.js'
import { authoredNovelSeats } from './bot-learning-novel-v3.js'
import { type OnlineForecastTuning, scoreOnlineActionForecaster } from './bot-learning-online-v3.js'
import { authoredShiftSeats } from './bot-learning-shift-v2.js'

export const BOT_LEARNING_ONLINE_CAMPAIGN_V3 = {
  baseSelectionSeed: 'opponent-online-v3-base-selection',
  styleSelectionSeed: 'opponent-online-v3-style-selection',
  baseConfirmationSeeds: ['opponent-online-v3-base-confirm-a', 'opponent-online-v3-base-confirm-b'],
  styleConfirmationSeed: 'opponent-online-v3-style-confirm',
  novelConfirmationSeed: 'opponent-online-v3-novel-confirm',
  eightSeatConfirmationSeed: 'opponent-online-v3-eight-confirm',
  nineSeatConfirmationSeed: 'opponent-online-v3-nine-confirm',
  selectionHands: 150,
  baseConfirmationHands: 250,
  styleConfirmationHands: 250,
  novelConfirmationHands: 300,
  tableConfirmationHands: 250,
} as const

export type OnlineCampaignV3 = {
  readonly [K in keyof typeof BOT_LEARNING_ONLINE_CAMPAIGN_V3]: (typeof BOT_LEARNING_ONLINE_CAMPAIGN_V3)[K] extends readonly string[]
    ? readonly string[]
    : (typeof BOT_LEARNING_ONLINE_CAMPAIGN_V3)[K] extends number
      ? number
      : string
}

const TUNING_GRID: readonly OnlineForecastTuning[] = [4, 8, 16].flatMap((minimumSamples) =>
  [1, 3, 6].map((advantageMargin) => ({
    minimumSamples,
    advantageMargin,
    learningRate: 0.2,
    evidenceDecay: 0.98,
    maximumCandidateWeight: 0.9,
  })),
)

export function runOnlineForecastCampaignV3(
  frozen: ActionModelV1,
  candidate: ActionModelV1,
  campaign: OnlineCampaignV3 = BOT_LEARNING_ONLINE_CAMPAIGN_V3,
) {
  const allSeeds = [
    campaign.baseSelectionSeed,
    campaign.styleSelectionSeed,
    ...campaign.baseConfirmationSeeds,
    campaign.styleConfirmationSeed,
    campaign.novelConfirmationSeed,
    campaign.eightSeatConfirmationSeed,
    campaign.nineSeatConfirmationSeed,
  ]
  const oldSeeds = Object.values(BOT_LEARNING_CAMPAIGN_V3).flatMap((value) =>
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [],
  )
  if (new Set([...allSeeds, ...oldSeeds]).size !== allSeeds.length + oldSeeds.length) {
    throw new Error('online campaign seed reuse')
  }
  if (campaign.baseConfirmationSeeds.length < 2) {
    throw new Error('online campaign needs two base confirmation seeds')
  }
  const cast = personalityPool()
  const baseSeats = BOT_LEARNING_CAMPAIGN_V3.trainingCastIndices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('online campaign base cast missing')
    return { personality }
  })
  const styleSeats = authoredShiftSeats(BOT_LEARNING_CAMPAIGN_V3.trainingCastIndices)
  const novelSeats = authoredNovelSeats(BOT_LEARNING_CAMPAIGN_V3.novelCastIndices)
  const ninth = cast[BOT_LEARNING_CAMPAIGN_V3.nineSeatCastIndex]
  if (ninth === undefined) throw new Error('online campaign ninth cast missing')
  const collect = (seed: string, hands: number, seats: readonly BenchmarkSeat[]) =>
    collectLearningExamplesV2({ seed, hands, seats })
  const baseSelection = collect(campaign.baseSelectionSeed, campaign.selectionHands, baseSeats)
  const styleSelection = collect(campaign.styleSelectionSeed, campaign.selectionHands, styleSeats)
  const frozenLoss = (examples: readonly LearningExampleV1[]) =>
    scoreActionPredictions(examples, (example) =>
      predictAction(frozen, example.features, example.legalLabels),
    )
  const baseFrozen = frozenLoss(baseSelection)
  const styleFrozen = frozenLoss(styleSelection)
  const selection = TUNING_GRID.map((tuning) => ({
    tuning,
    base: scoreOnlineActionForecaster(frozen, candidate, baseSelection, tuning),
    style: scoreOnlineActionForecaster(frozen, candidate, styleSelection, tuning),
  }))
  const eligible = selection.filter(
    (row) =>
      row.base.metrics.logLoss <= baseFrozen.logLoss + 1e-10 &&
      row.style.metrics.logLoss < styleFrozen.logLoss,
  )
  eligible.sort((a, b) => a.style.metrics.logLoss - b.style.metrics.logLoss)
  const selected = eligible[0] ?? null
  const compare = (examples: readonly LearningExampleV1[]) =>
    selected === null
      ? null
      : {
          frozen: frozenLoss(examples),
          online: scoreOnlineActionForecaster(frozen, candidate, examples, selected.tuning),
        }
  const baseTests = campaign.baseConfirmationSeeds.map((seed) => ({
    seed,
    comparison: compare(collect(seed, campaign.baseConfirmationHands, baseSeats)),
  }))
  const styleTest = compare(
    collect(campaign.styleConfirmationSeed, campaign.styleConfirmationHands, styleSeats),
  )
  const novelTest = compare(
    collect(campaign.novelConfirmationSeed, campaign.novelConfirmationHands, novelSeats),
  )
  const eightSeatTest = compare(
    collect(campaign.eightSeatConfirmationSeed, campaign.tableConfirmationHands, [
      ...baseSeats,
      ...novelSeats,
    ]),
  )
  const nineSeatTest = compare(
    collect(campaign.nineSeatConfirmationSeed, campaign.tableConfirmationHands, [
      ...baseSeats,
      ...novelSeats,
      { personality: ninth },
    ]),
  )
  const checked = [
    ...baseTests.map((test) => test.comparison),
    styleTest,
    novelTest,
    eightSeatTest,
    nineSeatTest,
  ]
  const noRegression = baseTests.every(
    (test) =>
      test.comparison !== null &&
      test.comparison.online.metrics.logLoss <= test.comparison.frozen.logLoss + 1e-10,
  )
  const positiveShift = [styleTest, novelTest, eightSeatTest, nineSeatTest].every(
    (test) =>
      test !== null &&
      (test.online.pairedLogLoss.confidence95?.[0] ?? Number.NEGATIVE_INFINITY) > 0,
  )
  const calibrated = checked.every(
    (test) => test !== null && test.online.metrics.calibrationError <= test.frozen.calibrationError,
  )
  return {
    kind: 'river-online-opponent-forecast-v3-experiment' as const,
    source: 'causal public actions from seeded synthetic players; no human data',
    selection: { baseFrozen, styleFrozen, selected, considered: selection.length },
    baseTests,
    styleTest,
    novelTest,
    eightSeatTest,
    nineSeatTest,
    checks: { noRegression, positiveShift, calibrated },
    shadowEligible: selected !== null && noRegression && positiveShift && calibrated,
    liveInferenceEnabled: false as const,
  }
}
