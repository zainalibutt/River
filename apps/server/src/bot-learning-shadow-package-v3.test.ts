import { describe, expect, it } from 'vitest'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1 } from './bot-learning-model.js'
import { ONLINE_FORECAST_TUNING_V3 } from './bot-learning-online-v3.js'
import {
  buildShadowPackageV3,
  loadShadowPackageV3,
  type ShadowPackagingGateV3,
} from './bot-learning-shadow-package-v3.js'

const frozen: ActionModelV1 = {
  version: 1,
  featureSchemaVersion: 2,
  featureNames: LEARNING_FEATURES_V2,
  labels: ACTION_LABELS,
  weights: ACTION_LABELS.map(() => Array(LEARNING_FEATURES_V2.length + 1).fill(0) as number[]),
  trainedExamples: 100,
  epochs: 1,
  temperature: 1,
}
const candidate: ActionModelV1 = { ...frozen, calibrationBias: [0, 1, 0, 0] }
const gate: ShadowPackagingGateV3 = {
  selectedTuning: ONLINE_FORECAST_TUNING_V3,
  shadowEligible: true,
  liveInferenceEnabled: false,
  checks: { noRegression: true, positiveShift: true, calibrated: true },
}

describe('experimental shadow package', () => {
  it('round-trips validated models, frozen fingerprint, and gate-selected tuning', () => {
    const packageValue = buildShadowPackageV3(frozen, candidate, gate)
    const parsed: unknown = JSON.parse(JSON.stringify(packageValue))
    expect(loadShadowPackageV3(parsed, frozen)).toEqual({
      candidate,
      tuning: ONLINE_FORECAST_TUNING_V3,
    })
    expect(packageValue.liveInferenceEnabled).toBe(false)
    expect(packageValue.source).toContain('no human data')
  })

  it('refuses a failed gate, changed model, wrong frozen baseline, or tuning drift', () => {
    expect(() =>
      buildShadowPackageV3(frozen, candidate, { ...gate, shadowEligible: false }),
    ).toThrow('passing offline gate')
    expect(() =>
      buildShadowPackageV3(frozen, candidate, {
        ...gate,
        selectedTuning: { ...ONLINE_FORECAST_TUNING_V3, minimumSamples: 8 },
      }),
    ).toThrow('tuning differs')
    const packageValue = buildShadowPackageV3(frozen, candidate, gate)
    expect(() => loadShadowPackageV3(packageValue, { ...frozen, temperature: 2 })).toThrow(
      'frozen model mismatch',
    )
    expect(() =>
      loadShadowPackageV3(
        { ...packageValue, model: { ...candidate, calibrationBias: [0, 2, 0, 0] } },
        frozen,
      ),
    ).toThrow('candidate model mismatch')
    expect(() =>
      loadShadowPackageV3(
        { ...packageValue, tuning: { ...ONLINE_FORECAST_TUNING_V3, minimumSamples: 8 } },
        frozen,
      ),
    ).toThrow('tuning mismatch')
    expect(() =>
      loadShadowPackageV3({ ...packageValue, liveInferenceEnabled: true }, frozen),
    ).toThrow('approval flags')
    expect(() => loadShadowPackageV3({ ...packageValue, source: 'unknown data' }, frozen)).toThrow(
      'provenance mismatch',
    )
  })
})
