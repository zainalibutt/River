import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateModel } from './bot-learning-model.js'
import { runSyntheticShadowCanaryV3 } from './bot-learning-shadow-canary-v3.js'
import { loadShadowPackageV3 } from './bot-learning-shadow-package-v3.js'

const frozenPath = fileURLToPath(
  new URL('../models/opponent-action-v2.experimental.json', import.meta.url),
)
const candidatePath = fileURLToPath(
  new URL('../models/opponent-action-v3.experimental.json', import.meta.url),
)
const frozenArtifact: unknown = JSON.parse(readFileSync(frozenPath, 'utf8'))
if (typeof frozenArtifact !== 'object' || frozenArtifact === null || !('model' in frozenArtifact)) {
  throw new Error('frozen v2 artifact missing model')
}
const frozen = frozenArtifact.model
validateModel(frozen)
const candidateArtifact: unknown = JSON.parse(readFileSync(candidatePath, 'utf8'))
const { candidate, tuning } = loadShadowPackageV3(candidateArtifact, frozen)
const result = await runSyntheticShadowCanaryV3(frozen, candidate, tuning, {
  seed: 'opponent-action-v3-shadow-canary',
  hands: 100,
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
