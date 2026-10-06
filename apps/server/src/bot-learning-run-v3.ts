import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runLearningCampaignV3 } from './bot-learning-campaign-v3.js'
import { validateModel } from './bot-learning-model.js'

const artifactPath = fileURLToPath(
  new URL('../models/opponent-action-v2.experimental.json', import.meta.url),
)
const frozenArtifact: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'))
if (typeof frozenArtifact !== 'object' || frozenArtifact === null || !('model' in frozenArtifact)) {
  throw new Error('frozen v2 artifact missing model')
}
const frozen = frozenArtifact.model
validateModel(frozen)
if (frozen.featureSchemaVersion !== 2) throw new Error('frozen v2 model schema mismatch')
const result = runLearningCampaignV3(frozen)
const concise = (test: {
  candidate: {
    learned: { logLoss: number; calibrationError: number; byClass: { raise: { recall: number } } }
  }
  frozen: {
    learned: { logLoss: number; calibrationError: number; byClass: { raise: { recall: number } } }
  }
  pairedLogLoss: { improvement: number; confidence95: readonly [number, number] | null }
}) => ({
  candidateLogLoss: test.candidate.learned.logLoss,
  frozenLogLoss: test.frozen.learned.logLoss,
  candidateCalibration: test.candidate.learned.calibrationError,
  frozenCalibration: test.frozen.learned.calibrationError,
  candidateRaiseRecall: test.candidate.learned.byClass.raise.recall,
  frozenRaiseRecall: test.frozen.learned.byClass.raise.recall,
  pairedImprovement: test.pairedLogLoss.improvement,
  pairedConfidence95: test.pairedLogLoss.confidence95,
})
process.stdout.write(
  `${JSON.stringify(
    {
      counts: result.counts,
      baseTests: result.baseTests.map((test) => ({ seed: test.seed, ...concise(test) })),
      knownStyleTest: concise(result.knownStyleTest),
      novelStyleTest: concise(result.novelStyleTest),
      eightSeatTest: concise(result.eightSeatTest),
      nineSeatTest: concise(result.nineSeatTest),
      novelByStyle: result.novelByStyle.map((test) => ({
        style: test.style,
        count: test.count,
        ...concise(test),
      })),
      checks: result.checks,
      promotionEligible: result.promotionEligible,
      liveInferenceEnabled: result.liveInferenceEnabled,
    },
    null,
    2,
  )}\n`,
)
