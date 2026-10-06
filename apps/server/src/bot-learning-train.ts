import { writeLearningArtifact } from './bot-learning-artifact.js'
import { runLearningCampaign } from './bot-learning-campaign.js'

const result = runLearningCampaign()
const output = writeLearningArtifact(result, 'opponent-action-v1.experimental.json')
process.stdout.write(
  `${JSON.stringify({ output, examples: result.examples, evaluation: result.evaluation, promotionEligible: result.promotionEligible }, null, 2)}\n`,
)
