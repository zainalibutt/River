import { writeLearningArtifact } from './bot-learning-artifact.js'
import { runLearningCampaignV2 } from './bot-learning-campaign-v2.js'

const result = runLearningCampaignV2()
const output = writeLearningArtifact(result, 'opponent-action-v2.experimental.json')
process.stdout.write(
  `${JSON.stringify({ output, examples: result.examples, promotionEligible: result.promotionEligible, confirmation: result.confirmationResults.map(({ seed, evaluation }) => ({ seed, logLossImprovement: evaluation.logLossImprovement, confidence95: evaluation.logLossConfidence95, calibrationImprovement: evaluation.calibrationImprovement, raiseRecall: evaluation.learned.byClass.raise.recall })), unseen: { logLossImprovement: result.unseenResult.evaluation.logLossImprovement, confidence95: result.unseenResult.evaluation.logLossConfidence95 } }, null, 2)}\n`,
)
