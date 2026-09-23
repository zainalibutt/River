import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { personalityPool } from '@river/engine'
import { ADAPTIVE_PRIORS_V2, predictAdaptiveActionV2 } from './bot-learning-adaptive-v2.js'
import { BOT_LEARNING_CAMPAIGN_V2 } from './bot-learning-campaign-v2.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import {
  type ActionMetrics,
  type ActionModelV1,
  predictAction,
  scoreActionPredictions,
  validateModel,
} from './bot-learning-model.js'
import { authoredShiftSeats, BOT_LEARNING_SHIFT_V2 } from './bot-learning-shift-v2.js'
import { botPlayerId } from './bot-service.js'

const source = dirname(fileURLToPath(import.meta.url))
const artifact = JSON.parse(
  readFileSync(resolve(source, '../models/opponent-action-v2.experimental.json'), 'utf8'),
) as {
  readonly model: ActionModelV1
  readonly promotionEligible: boolean
  readonly liveInferenceEnabled: boolean
}
validateModel(artifact.model)
if (artifact.promotionEligible || artifact.liveInferenceEnabled) {
  throw new Error('adaptive audit requires the frozen offline v2 artifact')
}

const cast = personalityPool()
const seats = BOT_LEARNING_CAMPAIGN_V2.castIndices.map((index) => {
  const personality = cast[index]
  if (personality === undefined) throw new Error('training cast missing')
  return { personality }
})
const unseenSeats = BOT_LEARNING_CAMPAIGN_V2.unseenCastIndices.map((index) => {
  const personality = cast[index]
  if (personality === undefined) throw new Error('unseen cast missing')
  return { personality }
})
const validation = collectLearningExamplesV2({
  seed: BOT_LEARNING_CAMPAIGN_V2.validationSeed,
  hands: BOT_LEARNING_CAMPAIGN_V2.validationHands,
  seats,
})
const choices: readonly (number | null)[] = [null, ...ADAPTIVE_PRIORS_V2]
const validationScores = choices.map((prior) => ({
  prior,
  metrics: metrics(validation, prior),
}))
const winner = validationScores.reduce((best, candidate) =>
  candidate.metrics.logLoss < best.metrics.logLoss ? candidate : best,
)

const confirmation = BOT_LEARNING_CAMPAIGN_V2.confirmationSeeds.map((seed) => {
  const examples = collectLearningExamplesV2({
    seed,
    hands: BOT_LEARNING_CAMPAIGN_V2.confirmationHandsPerSeed,
    seats,
  })
  return {
    seed,
    count: examples.length,
    base: metrics(examples, null),
    adapted: metrics(examples, winner.prior),
  }
})
const unseen = collectLearningExamplesV2({
  seed: BOT_LEARNING_CAMPAIGN_V2.unseenSeed,
  hands: BOT_LEARNING_CAMPAIGN_V2.unseenHands,
  seats: unseenSeats,
})
const shiftedSeats = authoredShiftSeats(BOT_LEARNING_SHIFT_V2.castIndices)
const shift = collectLearningExamplesV2({
  seed: BOT_LEARNING_SHIFT_V2.seed,
  hands: BOT_LEARNING_SHIFT_V2.hands,
  seats: shiftedSeats,
})
const byStyle = shiftedSeats.map((seat) => {
  const examples = shift.filter((example) => example.actorId === botPlayerId(seat.personality.id))
  return {
    policy: seat.policy?.id,
    count: examples.length,
    base: metrics(examples, null),
    adapted: metrics(examples, winner.prior),
  }
})

process.stdout.write(
  `${JSON.stringify(
    {
      source: 'frozen v2 model and causal public actor history; synthetic held-out hands only',
      selectedPrior: winner.prior,
      validationScores,
      confirmation,
      unseen: {
        count: unseen.length,
        base: metrics(unseen, null),
        adapted: metrics(unseen, winner.prior),
      },
      shift: {
        count: shift.length,
        base: metrics(shift, null),
        adapted: metrics(shift, winner.prior),
        byStyle,
      },
      liveInferenceEnabled: false,
    },
    null,
    2,
  )}\n`,
)

function metrics(
  examples: ReturnType<typeof collectLearningExamplesV2>,
  prior: number | null,
): ActionMetrics {
  return scoreActionPredictions(examples, (example) =>
    prior === null
      ? predictAction(artifact.model, example.features, example.legalLabels)
      : predictAdaptiveActionV2(artifact.model, example, prior),
  )
}
