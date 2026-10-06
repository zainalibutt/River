import { type BotObservationV1, type BotPolicy, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { BenchmarkOptions } from './bot-benchmark.js'
import { extractLearningFeaturesV1 } from './bot-learning-data.js'
import { collectLearningExamplesV2, LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'

const seats = personalityPool()
  .slice(0, 3)
  .map((personality) => ({ personality }))

describe('learning data v2', () => {
  it('replays deterministically with unique finite bounded features', () => {
    const options: BenchmarkOptions = { seed: 'learning-v2-replay', hands: 8, seats }
    const rows = collectLearningExamplesV2(options)
    expect(rows.length).toBeGreaterThan(0)
    expect(collectLearningExamplesV2(options)).toEqual(rows)
    expect(new Set(LEARNING_FEATURES_V2).size).toBe(LEARNING_FEATURES_V2.length)
    expect(LEARNING_FEATURES_V2.slice(20)).toEqual([
      'actor_facing_bet_sample_count',
      'actor_facing_bet_fold_smoothed_rate',
      'actor_facing_bet_call_smoothed_rate',
      'actor_facing_bet_raise_smoothed_rate',
      'actor_free_action_sample_count',
      'actor_free_action_fold_smoothed_rate',
      'actor_free_action_check_smoothed_rate',
      'actor_free_action_raise_smoothed_rate',
    ])
    for (const row of rows) {
      expect(row.features).toHaveLength(LEARNING_FEATURES_V2.length)
      expect(
        row.features.every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
      ).toBe(true)
      expect(row.legalLabels).toContain(row.label)
    }
  })

  it('uses only earlier accepted actions from the same actor', () => {
    const contexts: { actorId: string; facing: boolean }[] = []
    const rows = collectLearningExamplesV2({
      seed: 'learning-v2-causal',
      hands: 12,
      seats,
      onDecision({ actorId, observation }) {
        contexts.push({ actorId, facing: observation.amountToCall > 0 })
      },
    })
    const counts = new Map<
      string,
      {
        facingFold: number
        call: number
        facingRaise: number
        freeFold: number
        check: number
        freeRaise: number
      }
    >()
    let sawFutureSample = false
    let sawOtherActorAfterHistory = false
    for (const [index, row] of rows.entries()) {
      const context = contexts[index]
      if (context === undefined) throw new Error('missing decision context')
      const prior = counts.get(context.actorId) ?? {
        facingFold: 0,
        call: 0,
        facingRaise: 0,
        freeFold: 0,
        check: 0,
        freeRaise: 0,
      }
      const facingTotal = prior.facingFold + prior.call + prior.facingRaise
      const freeTotal = prior.freeFold + prior.check + prior.freeRaise
      const expected = [
        facingTotal / (facingTotal + 4),
        (prior.facingFold + 1) / (facingTotal + 3),
        (prior.call + 1) / (facingTotal + 3),
        (prior.facingRaise + 1) / (facingTotal + 3),
        freeTotal / (freeTotal + 4),
        (prior.freeFold + 1) / (freeTotal + 3),
        (prior.check + 1) / (freeTotal + 3),
        (prior.freeRaise + 1) / (freeTotal + 3),
      ]
      expect(row.features.slice(-8)).toEqual(expected)
      if (facingTotal + freeTotal > 0) sawFutureSample = true
      if (facingTotal + freeTotal === 0 && counts.size > 0) sawOtherActorAfterHistory = true
      if (context.facing) {
        if (row.label === 'fold') prior.facingFold += 1
        if (row.label === 'call') prior.call += 1
        if (row.label === 'raise') prior.facingRaise += 1
      } else {
        if (row.label === 'fold') prior.freeFold += 1
        if (row.label === 'check') prior.check += 1
        if (row.label === 'raise') prior.freeRaise += 1
      }
      counts.set(context.actorId, prior)
    }
    expect(sawFutureSample).toBe(true)
    expect(sawOtherActorAfterHistory).toBe(true)
    expect(counts.size).toBe(seats.length)
  })

  it('keeps hole cards and hidden identity out of the current feature vector', () => {
    const observations: BotObservationV1[] = []
    const rows = collectLearningExamplesV2({
      seed: 'learning-v2-public-only',
      hands: 2,
      seats,
      onDecision({ observation }) {
        observations.push(observation)
      },
    })
    const first = observations[0]
    const row = rows[0]
    if (first === undefined || row === undefined) throw new Error('missing first learning example')
    const altered: BotObservationV1 = {
      ...first,
      roomId: 'different-room',
      handNumber: 999,
      actor: { ...first.actor, playerId: 'different-actor', hole: [] },
      seats: first.seats.map((seat) => ({ ...seat, playerId: 'different-player' })),
      opponents: [],
    }
    expect(row.features.slice(0, 20)).toEqual(extractLearningFeaturesV1(first))
    expect(extractLearningFeaturesV1(altered)).toEqual(extractLearningFeaturesV1(first))
    expect(row.features.slice(20)).toEqual([0, 1 / 3, 1 / 3, 1 / 3, 0, 1 / 3, 1 / 3, 1 / 3])
  })

  it('counts a legal fold with no bet to call as a free action', () => {
    const policy: BotPolicy = {
      id: 'call-then-free-fold',
      version: 1,
      decide(context) {
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: context.observation.version,
          decision: context.observation.amountToCall > 0 ? { kind: 'call' } : { kind: 'fold' },
          fallbackReason: null,
        }
      },
    }
    const contexts: { actorId: string; facing: boolean }[] = []
    const rows = collectLearningExamplesV2({
      seed: 'learning-v2-free-fold',
      hands: 4,
      seats: seats.slice(0, 2).map((seat) => ({ ...seat, policy })),
      onDecision({ actorId, observation }) {
        contexts.push({ actorId, facing: observation.amountToCall > 0 })
      },
    })
    const freeFold = rows.findIndex(
      (row, index) => !contexts[index]?.facing && row.label === 'fold',
    )
    expect(freeFold).toBeGreaterThanOrEqual(0)
    const actorId = rows[freeFold]?.actorId
    const later = rows.find((row, index) => index > freeFold && row.actorId === actorId)
    expect(later).toBeDefined()
    expect(
      later?.features[LEARNING_FEATURES_V2.indexOf('actor_free_action_sample_count')],
    ).toBeGreaterThan(0)
    expect(
      later?.features[LEARNING_FEATURES_V2.indexOf('actor_free_action_fold_smoothed_rate')],
    ).toBeGreaterThan(1 / 3)
  })
})
