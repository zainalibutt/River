import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeLearningArtifact } from './bot-learning-artifact.js'
import { runLearningCampaignV3 } from './bot-learning-campaign-v3.js'
import { validateModel } from './bot-learning-model.js'
import { runOnlineForecastCampaignV3 } from './bot-learning-online-campaign-v3.js'
import { buildShadowPackageV3, loadShadowPackageV3 } from './bot-learning-shadow-package-v3.js'

const frozenPath = fileURLToPath(
  new URL('../models/opponent-action-v2.experimental.json', import.meta.url),
)
const frozenArtifact: unknown = JSON.parse(readFileSync(frozenPath, 'utf8'))
if (typeof frozenArtifact !== 'object' || frozenArtifact === null || !('model' in frozenArtifact)) {
  throw new Error('frozen v2 artifact missing model')
}
const frozen = frozenArtifact.model
validateModel(frozen)
const training = runLearningCampaignV3(frozen)
const gate = runOnlineForecastCampaignV3(frozen, training.candidate)
const packaged = buildShadowPackageV3(frozen, training.candidate, {
  selectedTuning: gate.selection.selected?.tuning ?? null,
  shadowEligible: gate.shadowEligible,
  liveInferenceEnabled: gate.liveInferenceEnabled,
  checks: gate.checks,
})
const output = writeLearningArtifact(packaged, 'opponent-action-v3.experimental.json')
const reread: unknown = JSON.parse(readFileSync(output, 'utf8'))
loadShadowPackageV3(reread, frozen)
process.stdout.write(
  `${JSON.stringify({ output, frozenModelSha256: packaged.frozenModelSha256, candidateModelSha256: packaged.candidateModelSha256, selectedTuning: packaged.tuning, shadowEligible: packaged.shadowEligible, liveInferenceEnabled: packaged.liveInferenceEnabled }, null, 2)}\n`,
)
