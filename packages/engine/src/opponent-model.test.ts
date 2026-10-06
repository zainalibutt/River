import { describe, expect, it } from 'vitest'
import { DEFAULT_OPPONENT_MODEL_TUNING } from './config.js'
import type { HandAction, HandRecord } from './hand-history.js'
import {
  opponentEvidenceFromHand,
  summariseOpponentModel,
  updateOpponentModel,
} from './opponent-model.js'

function record(actions: HandAction[], showed = false): HandRecord {
  return {
    handNumber: 7,
    startedAtMs: 1_700_000_000_000,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 100_000 },
      { seat: 1, playerId: 'bob', startingStack: 100_000 },
    ],
    actions,
    board: [],
    potSize: 10_000,
    results: [
      { seat: 0, delta: 5_000, showed },
      { seat: 1, delta: -5_000, showed: false },
    ],
    commit: 'commit-seven',
    revealedSeed: null,
  }
}

describe('opponent evidence', () => {
  it('extracts only public action tendencies for the requested player', () => {
    const evidence = opponentEvidenceFromHand(
      record(
        [
          {
            seat: 0,
            street: 'preflop',
            action: { kind: 'raiseTo', to: 1_500 },
            amountCommitted: 1_500,
            potBefore: 750,
            streetBetAfter: 1_500,
          },
          {
            seat: 1,
            street: 'preflop',
            action: { kind: 'call' },
            amountCommitted: 1_000,
            potBefore: 2_250,
            streetBetAfter: 1_500,
          },
          {
            seat: 0,
            street: 'flop',
            action: { kind: 'raiseTo', to: 2_000 },
            amountCommitted: 2_000,
            potBefore: 3_000,
            streetBetAfter: 2_000,
          },
        ],
        true,
      ),
      'alice',
      DEFAULT_OPPONENT_MODEL_TUNING,
    )
    expect(evidence).toEqual({
      vpip: true,
      pfr: true,
      aggressiveActions: 2,
      passiveCalls: 0,
      showdown: true,
      aggressivePotRatios: [2, 2 / 3],
    })
    expect(evidence).not.toHaveProperty('hole')
    expect(evidence).not.toHaveProperty('bluff')
  })

  it('does not count an all-in call as aggression', () => {
    const evidence = opponentEvidenceFromHand(
      record([
        {
          seat: 1,
          street: 'river',
          action: { kind: 'raiseTo', to: 4_000 },
          amountCommitted: 4_000,
          potBefore: 5_000,
          streetBetAfter: 4_000,
        },
        {
          seat: 0,
          street: 'river',
          action: { kind: 'allIn' },
          amountCommitted: 4_000,
          potBefore: 9_000,
          streetBetAfter: 4_000,
        },
      ]),
      'alice',
      DEFAULT_OPPONENT_MODEL_TUNING,
    )
    expect(evidence?.aggressiveActions).toBe(0)
    expect(evidence?.passiveCalls).toBe(1)
  })

  it('does not invent a sizing sample for an older action without numeric facts', () => {
    const evidence = opponentEvidenceFromHand(
      record([{ seat: 0, street: 'preflop', action: { kind: 'raiseTo', to: 1_500 } }]),
      'alice',
      DEFAULT_OPPONENT_MODEL_TUNING,
    )
    expect(evidence?.pfr).toBe(true)
    expect(evidence?.aggressivePotRatios).toEqual([])
  })

  it('returns no evidence for a player who was not dealt into the hand', () => {
    expect(opponentEvidenceFromHand(record([]), 'carol', DEFAULT_OPPONENT_MODEL_TUNING)).toBeNull()
  })
})

describe('opponent model', () => {
  it('keeps a single unusual hand low confidence and pulled toward the population prior', () => {
    const evidence = {
      vpip: true,
      pfr: true,
      aggressiveActions: 3,
      passiveCalls: 0,
      showdown: true,
      aggressivePotRatios: [1.5],
    }
    const state = updateOpponentModel(null, evidence, 1_000, DEFAULT_OPPONENT_MODEL_TUNING)
    const summary = summariseOpponentModel(state, DEFAULT_OPPONENT_MODEL_TUNING)
    expect(summary.sampleCount).toBe(1)
    expect(summary.confidence).toBeLessThan(0.06)
    expect(summary.vpip).toBeLessThan(0.4)
    expect(summary.pfr).toBeLessThan(0.3)
  })

  it('gains confidence across repeated evidence without reaching certainty', () => {
    const evidence = {
      vpip: true,
      pfr: true,
      aggressiveActions: 2,
      passiveCalls: 0,
      showdown: false,
      aggressivePotRatios: [0.9],
    }
    let state = updateOpponentModel(null, evidence, 1_000, DEFAULT_OPPONENT_MODEL_TUNING)
    for (let hand = 1; hand < 40; hand += 1) {
      state = updateOpponentModel(state, evidence, 1_000 + hand, DEFAULT_OPPONENT_MODEL_TUNING)
    }
    const summary = summariseOpponentModel(state, DEFAULT_OPPONENT_MODEL_TUNING)
    expect(summary.confidence).toBeGreaterThan(0.8)
    expect(summary.confidence).toBeLessThan(1)
    expect(summary.vpip).toBeGreaterThan(0.8)
    expect(summary.pfr).toBeGreaterThan(0.8)
    expect(summary.aggressionFrequency).toBeGreaterThan(0.9)
  })

  it('halves old evidence after one configured half-life before adding the new hand', () => {
    const evidence = {
      vpip: true,
      pfr: false,
      aggressiveActions: 0,
      passiveCalls: 1,
      showdown: false,
      aggressivePotRatios: [],
    }
    let state = updateOpponentModel(null, evidence, 0, DEFAULT_OPPONENT_MODEL_TUNING)
    for (let hand = 1; hand < 10; hand += 1) {
      state = updateOpponentModel(state, evidence, hand, DEFAULT_OPPONENT_MODEL_TUNING)
    }
    const decayed = updateOpponentModel(
      state,
      evidence,
      state.lastSeenAtMs + DEFAULT_OPPONENT_MODEL_TUNING.halfLifeMs,
      DEFAULT_OPPONENT_MODEL_TUNING,
    )
    expect(decayed.weightedHands).toBeCloseTo(state.weightedHands / 2 + 1, 6)
    expect(decayed.weightedVpip).toBeCloseTo(state.weightedVpip / 2 + 1, 6)
  })

  it('changes a mature read gradually when recent behaviour changes', () => {
    const aggressive = {
      vpip: true,
      pfr: true,
      aggressiveActions: 2,
      passiveCalls: 0,
      showdown: false,
      aggressivePotRatios: [1],
    }
    const passive = {
      vpip: false,
      pfr: false,
      aggressiveActions: 0,
      passiveCalls: 1,
      showdown: true,
      aggressivePotRatios: [],
    }
    let state = updateOpponentModel(null, aggressive, 0, DEFAULT_OPPONENT_MODEL_TUNING)
    for (let hand = 1; hand < 30; hand += 1) {
      state = updateOpponentModel(state, aggressive, hand, DEFAULT_OPPONENT_MODEL_TUNING)
    }
    const before = summariseOpponentModel(state, DEFAULT_OPPONENT_MODEL_TUNING)
    const recentAt = state.lastSeenAtMs + DEFAULT_OPPONENT_MODEL_TUNING.halfLifeMs
    state = updateOpponentModel(state, passive, recentAt, DEFAULT_OPPONENT_MODEL_TUNING)
    const afterOne = summariseOpponentModel(state, DEFAULT_OPPONENT_MODEL_TUNING)
    for (let hand = 1; hand < 20; hand += 1) {
      state = updateOpponentModel(state, passive, recentAt + hand, DEFAULT_OPPONENT_MODEL_TUNING)
    }
    const afterRun = summariseOpponentModel(state, DEFAULT_OPPONENT_MODEL_TUNING)
    expect(afterOne.aggressionFrequency).toBeLessThan(before.aggressionFrequency)
    expect(afterOne.aggressionFrequency).toBeGreaterThan(0.7)
    expect(afterRun.aggressionFrequency).toBeLessThan(afterOne.aggressionFrequency)
    expect(afterRun.showdownFrequency).toBeGreaterThan(afterOne.showdownFrequency)
    expect(afterRun.confidence).toBeLessThan(1)
  })
})
