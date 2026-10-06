import { createHash } from 'node:crypto'
import { BOT_LEARNING_CAMPAIGN_V3 } from './bot-learning-campaign-v3.js'
import { type ActionModelV1, validateModel } from './bot-learning-model.js'
import { BOT_LEARNING_ONLINE_CAMPAIGN_V3 } from './bot-learning-online-campaign-v3.js'
import {
  ONLINE_FORECAST_TUNING_V3,
  OnlineActionForecaster,
  type OnlineForecastTuning,
} from './bot-learning-online-v3.js'

export interface ShadowPackagingGateV3 {
  readonly selectedTuning: OnlineForecastTuning | null
  readonly shadowEligible: boolean
  readonly liveInferenceEnabled: boolean
  readonly checks: {
    readonly noRegression: boolean
    readonly positiveShift: boolean
    readonly calibrated: boolean
  }
}

export function buildShadowPackageV3(
  frozen: ActionModelV1,
  candidate: ActionModelV1,
  gate: ShadowPackagingGateV3,
) {
  validateModel(frozen)
  validateModel(candidate)
  if (frozen.featureSchemaVersion !== 2 || candidate.featureSchemaVersion !== 2) {
    throw new Error('shadow package needs schema-two models')
  }
  if (
    !gate.shadowEligible ||
    gate.liveInferenceEnabled ||
    !gate.checks.noRegression ||
    !gate.checks.positiveShift ||
    !gate.checks.calibrated ||
    gate.selectedTuning === null
  ) {
    throw new Error('shadow package needs the passing offline gate')
  }
  if (!sameTuning(gate.selectedTuning, ONLINE_FORECAST_TUNING_V3)) {
    throw new Error('shadow package tuning differs from selected offline gate')
  }
  new OnlineActionForecaster(frozen, candidate, gate.selectedTuning)
  return {
    kind: 'river-opponent-action-v3-shadow-experiment' as const,
    source: 'seeded synthetic public actions; no human data',
    frozenModelSha256: modelSha256(frozen),
    candidateModelSha256: modelSha256(candidate),
    trainingCampaign: BOT_LEARNING_CAMPAIGN_V3,
    onlineCampaign: BOT_LEARNING_ONLINE_CAMPAIGN_V3,
    tuning: gate.selectedTuning,
    checks: gate.checks,
    shadowEligible: true as const,
    liveInferenceEnabled: false as const,
    model: candidate,
  }
}

export function loadShadowPackageV3(
  value: unknown,
  frozen: ActionModelV1,
): {
  readonly candidate: ActionModelV1
  readonly tuning: OnlineForecastTuning
} {
  validateModel(frozen)
  if (frozen.featureSchemaVersion !== 2) throw new Error('shadow frozen model schema mismatch')
  if (!isRecord(value) || value.kind !== 'river-opponent-action-v3-shadow-experiment') {
    throw new Error('invalid shadow package kind')
  }
  if (value.shadowEligible !== true || value.liveInferenceEnabled !== false) {
    throw new Error('shadow package approval flags mismatch')
  }
  if (
    value.source !== 'seeded synthetic public actions; no human data' ||
    JSON.stringify(value.trainingCampaign) !== JSON.stringify(BOT_LEARNING_CAMPAIGN_V3) ||
    JSON.stringify(value.onlineCampaign) !== JSON.stringify(BOT_LEARNING_ONLINE_CAMPAIGN_V3)
  ) {
    throw new Error('shadow package provenance mismatch')
  }
  if (value.frozenModelSha256 !== modelSha256(frozen)) {
    throw new Error('shadow package frozen model mismatch')
  }
  if (
    !isRecord(value.checks) ||
    value.checks.noRegression !== true ||
    value.checks.positiveShift !== true ||
    value.checks.calibrated !== true
  ) {
    throw new Error('shadow package gate checks missing')
  }
  if (!isTuning(value.tuning) || !sameTuning(value.tuning, ONLINE_FORECAST_TUNING_V3)) {
    throw new Error('shadow package tuning mismatch')
  }
  const candidate = value.model
  validateModel(candidate)
  if (
    candidate.featureSchemaVersion !== 2 ||
    value.candidateModelSha256 !== modelSha256(candidate)
  ) {
    throw new Error('shadow package candidate model mismatch')
  }
  new OnlineActionForecaster(frozen, candidate, value.tuning)
  return { candidate, tuning: value.tuning }
}

function modelSha256(model: ActionModelV1): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex')
}

function sameTuning(left: OnlineForecastTuning, right: OnlineForecastTuning): boolean {
  return (
    left.minimumSamples === right.minimumSamples &&
    left.advantageMargin === right.advantageMargin &&
    left.learningRate === right.learningRate &&
    left.evidenceDecay === right.evidenceDecay &&
    left.maximumCandidateWeight === right.maximumCandidateWeight
  )
}

function isTuning(value: unknown): value is OnlineForecastTuning {
  return (
    isRecord(value) &&
    typeof value.minimumSamples === 'number' &&
    typeof value.advantageMargin === 'number' &&
    typeof value.learningRate === 'number' &&
    typeof value.evidenceDecay === 'number' &&
    typeof value.maximumCandidateWeight === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
