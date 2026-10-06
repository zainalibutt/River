import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { personalityPool } from '@river/engine'
import { BOT_LEARNING_CAMPAIGN_V2 } from './bot-learning-campaign-v2.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { type ActionModelV1, validateModel } from './bot-learning-model.js'
import { runLearningShiftV2 } from './bot-learning-shift-v2.js'

const source = dirname(fileURLToPath(import.meta.url))
const artifact = JSON.parse(
  readFileSync(resolve(source, '../models/opponent-action-v2.experimental.json'), 'utf8'),
) as {
  readonly campaign: typeof BOT_LEARNING_CAMPAIGN_V2
  readonly promotionEligible: boolean
  readonly liveInferenceEnabled: boolean
  readonly model: ActionModelV1
}
validateModel(artifact.model)
if (
  artifact.campaign.trainingSeed !== BOT_LEARNING_CAMPAIGN_V2.trainingSeed ||
  artifact.campaign.trainingHands !== BOT_LEARNING_CAMPAIGN_V2.trainingHands ||
  artifact.promotionEligible !== false ||
  artifact.liveInferenceEnabled !== false
) {
  throw new Error('opponent-action v2 artifact is not the expected frozen experiment')
}
const cast = personalityPool()
const seats = BOT_LEARNING_CAMPAIGN_V2.castIndices.map((index) => {
  const personality = cast[index]
  if (personality === undefined) throw new Error('training cast missing')
  return { personality }
})
const training = collectLearningExamplesV2({
  seed: BOT_LEARNING_CAMPAIGN_V2.trainingSeed,
  hands: BOT_LEARNING_CAMPAIGN_V2.trainingHands,
  seats,
})
if (training.length !== artifact.model.trainedExamples) {
  throw new Error('frozen model and regenerated training population differ')
}
const result = runLearningShiftV2(artifact.model, training)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
