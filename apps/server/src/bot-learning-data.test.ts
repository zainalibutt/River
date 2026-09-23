import { type BotObservationV1, type BotPolicy, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type BenchmarkOptions, runBotBenchmark } from './bot-benchmark.js'
import {
  collectLearningExamples,
  extractLearningFeaturesV1,
  LEARNING_FEATURES_V1,
  LEARNING_SCHEMA_VERSION,
} from './bot-learning-data.js'

const seats = personalityPool()
  .slice(0, 3)
  .map((personality) => ({ personality }))

describe('learning data sidecar', () => {
  it('uses a stable finite bounded schema and deterministic hand groups', () => {
    const options: BenchmarkOptions = { seed: 'learning-replay', hands: 4, seats }
    const first = collectLearningExamples(options)
    expect(LEARNING_SCHEMA_VERSION).toBe(1)
    expect(new Set(LEARNING_FEATURES_V1).size).toBe(LEARNING_FEATURES_V1.length)
    expect(first.length).toBeGreaterThan(0)
    expect(collectLearningExamples(options)).toEqual(first)
    expect(new Set(first.map((example) => example.handId)).size).toBe(4)
    for (const example of first) {
      expect(example.features).toHaveLength(LEARNING_FEATURES_V1.length)
      expect(
        example.features.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
      ).toBe(true)
      expect(example.legalLabels).toContain(example.label)
      expect(example.actorId).toMatch(/^bot:/)
    }
  })

  it('keeps hole cards, identity, tilt and hidden opponent summaries out of numeric features', () => {
    let sample: BotObservationV1 | undefined
    runBotBenchmark({
      seed: 'learning-leakage',
      hands: 1,
      seats,
      onDecision({ observation }) {
        sample ??= observation
      },
    })
    if (sample === undefined) throw new Error('benchmark supplied no observation')
    const baseline = extractLearningFeaturesV1(sample)
    const altered: BotObservationV1 = {
      ...sample,
      roomId: 'another-room',
      handNumber: 999,
      actor: { ...sample.actor, playerId: 'another-actor', hole: [] },
      seats: sample.seats.map((seat) => ({ ...seat, playerId: 'another-id' })),
      opponents: [],
      tilt: { factor: 1, cause: 'hidden-state', updatedAtMs: 999 },
    }
    expect(extractLearningFeaturesV1(altered)).toEqual(baseline)
    expect(extractLearningFeaturesV1({ ...sample, pot: sample.pot + 500 })).not.toEqual(baseline)
  })

  it('labels a covering all-in as a raise and a matching all-in as a call', () => {
    const allInPolicy: BotPolicy = {
      id: 'always-all-in',
      version: 1,
      decide(context) {
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: context.observation.version,
          decision: { kind: 'allIn' },
          fallbackReason: null,
        }
      },
    }
    const examples = collectLearningExamples({
      seed: 'all-in-labels',
      hands: 1,
      seats: seats.slice(0, 2).map((seat) => ({ ...seat, policy: allInPolicy })),
    })
    expect(examples.map((example) => example.label)).toEqual(['raise', 'call'])
    expect(examples[0]?.legalLabels).toContain('raise')
    expect(examples[1]?.legalLabels).toContain('call')
    expect(examples[1]?.features[LEARNING_FEATURES_V1.indexOf('legal_raise')]).toBe(0)
  })
})
