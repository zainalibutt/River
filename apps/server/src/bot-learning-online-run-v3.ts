import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runLearningCampaignV3 } from './bot-learning-campaign-v3.js'
import { validateModel } from './bot-learning-model.js'
import { runOnlineForecastCampaignV3 } from './bot-learning-online-campaign-v3.js'

const artifactPath = fileURLToPath(
  new URL('../models/opponent-action-v2.experimental.json', import.meta.url),
)
const artifact: unknown = JSON.parse(readFileSync(artifactPath, 'utf8'))
if (typeof artifact !== 'object' || artifact === null || !('model' in artifact)) {
  throw new Error('frozen v2 artifact missing model')
}
const frozen = artifact.model
validateModel(frozen)
const candidate = runLearningCampaignV3(frozen).candidate
const result = runOnlineForecastCampaignV3(frozen, candidate)
const concise = (comparison: typeof result.novelTest) =>
  comparison === null
    ? null
    : {
        frozenLogLoss: comparison.frozen.logLoss,
        onlineLogLoss: comparison.online.metrics.logLoss,
        frozenCalibration: comparison.frozen.calibrationError,
        onlineCalibration: comparison.online.metrics.calibrationError,
        adaptedForecasts: comparison.online.adaptedForecasts,
        totalForecasts: comparison.online.totalForecasts,
        pairedImprovement: comparison.online.pairedLogLoss,
      }
process.stdout.write(
  `${JSON.stringify(
    {
      selectedTuning: result.selection.selected?.tuning ?? null,
      selectionBase: {
        frozen: result.selection.baseFrozen.logLoss,
        online: result.selection.selected?.base.metrics.logLoss ?? null,
      },
      selectionStyle: {
        frozen: result.selection.styleFrozen.logLoss,
        online: result.selection.selected?.style.metrics.logLoss ?? null,
      },
      baseTests: result.baseTests.map((test) => ({ seed: test.seed, ...concise(test.comparison) })),
      styleTest: concise(result.styleTest),
      novelTest: concise(result.novelTest),
      eightSeatTest: concise(result.eightSeatTest),
      nineSeatTest: concise(result.nineSeatTest),
      checks: result.checks,
      shadowEligible: result.shadowEligible,
      liveInferenceEnabled: result.liveInferenceEnabled,
    },
    null,
    2,
  )}\n`,
)
