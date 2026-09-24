import { describe, expect, it } from 'vitest'
import { parseCard } from './cards.js'
import { HandCategory } from './evaluator.js'
import type { HandAction, HandRecord } from './hand-history.js'
import {
  publicBetSize,
  publicEvidenceFromHand,
  rateEstimate,
  summariseOpponentStats,
  updateOpponentStats,
} from './opponent-stats.js'

const board = ['Ah', 'Kd', '7c', '7s', '2h'].map(parseCard)

function act(
  seat: number,
  street: HandAction['street'],
  action: HandAction['action'],
  amountCommitted: number,
  potBefore: number,
  streetBetAfter: number,
): HandAction {
  return { seat, street, action, amountCommitted, potBefore, streetBetAfter }
}

function record(
  actions: HandAction[],
  showed: readonly boolean[] = [false, false, false],
): HandRecord {
  return {
    handNumber: 3,
    startedAtMs: 0,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'ann', startingStack: 100_000 },
      { seat: 1, playerId: 'bea', startingStack: 100_000 },
      { seat: 2, playerId: 'cal', startingStack: 100_000 },
    ],
    actions,
    board,
    potSize: 12_000,
    results: showed.map((shown, seat) => ({ seat, delta: 0, showed: shown })),
    commit: 'commit-three',
    revealedSeed: null,
  }
}

const hand = record(
  [
    act(0, 'preflop', { kind: 'raiseTo', to: 1_500 }, 1_500, 750, 1_500),
    act(1, 'preflop', { kind: 'raiseTo', to: 4_500 }, 4_250, 2_250, 4_500),
    act(2, 'preflop', { kind: 'fold' }, 0, 6_500, 500),
    act(0, 'preflop', { kind: 'call' }, 3_000, 6_500, 4_500),
    act(0, 'flop', { kind: 'check' }, 0, 9_500, 0),
    act(1, 'flop', { kind: 'raiseTo', to: 3_000 }, 3_000, 9_500, 3_000),
    act(0, 'flop', { kind: 'call' }, 3_000, 12_500, 3_000),
    act(0, 'turn', { kind: 'check' }, 0, 15_500, 0),
    act(1, 'turn', { kind: 'check' }, 0, 15_500, 0),
    act(0, 'river', { kind: 'raiseTo', to: 20_000 }, 20_000, 15_500, 20_000),
    act(1, 'river', { kind: 'fold' }, 0, 35_500, 0),
  ],
  [true, false, false],
)

describe('public opponent evidence', () => {
  it('counts preflop entry, raises and folds to a raise from accepted actions only', () => {
    const ann = publicEvidenceFromHand(hand, 'ann')
    const bea = publicEvidenceFromHand(hand, 'bea')
    const cal = publicEvidenceFromHand(hand, 'cal')
    expect([ann?.vpip, ann?.pfr, ann?.facedPreflopRaise]).toEqual([true, true, 1])
    expect([bea?.vpip, bea?.pfr, bea?.facedPreflopRaise]).toEqual([true, true, 1])
    expect([cal?.vpip, cal?.pfr, cal?.facedPreflopRaise, cal?.foldedToPreflopRaise]).toEqual([
      false,
      false,
      1,
      1,
    ])
  })

  it('separates a bet into a checked-to spot from a call of somebody else’s bet', () => {
    const ann = publicEvidenceFromHand(hand, 'ann')
    const bea = publicEvidenceFromHand(hand, 'bea')
    expect(ann?.streets.flop).toMatchObject({ facedBet: 1, foldedToBet: 0, checkedTo: 1 })
    expect(bea?.streets.flop).toMatchObject({ checkedTo: 1, betWhenCheckedTo: 1 })
    expect(bea?.streets.flop.betSizes).toEqual({ small: 1, medium: 0, large: 0 })
    expect(ann?.streets.turn).toMatchObject({ checkedTo: 1, betWhenCheckedTo: 0 })
    expect(ann?.streets.river).toMatchObject({ checkedTo: 1, betWhenCheckedTo: 1 })
    expect(ann?.streets.river.betSizes).toEqual({ small: 0, medium: 0, large: 1 })
    expect(bea?.streets.river).toMatchObject({ facedBet: 1, foldedToBet: 1 })
  })

  it('reads a shown river bet only when the player showed and the cards were public', () => {
    const shown = [parseCard('As'), parseCard('Ad')]
    expect(publicEvidenceFromHand(hand, 'ann', shown)?.shownRiverAggression).toBe(
      HandCategory.FULL_HOUSE,
    )
    expect(publicEvidenceFromHand(hand, 'ann')?.shownRiverAggression).toBeNull()
    const unshown = record(hand.actions, [false, false, false])
    expect(publicEvidenceFromHand(unshown, 'ann', shown)?.shownRiverAggression).toBeNull()
    expect(publicEvidenceFromHand(hand, 'bea', shown)?.shownRiverAggression).toBeNull()
  })

  it('has nothing to say about a player who was not dealt in', () => {
    expect(publicEvidenceFromHand(hand, 'dan')).toBeNull()
  })

  it('invents no bet size when the record lacks the amounts', () => {
    const bare = record([
      { seat: 0, street: 'flop', action: { kind: 'raiseTo', to: 900 } },
      { seat: 1, street: 'flop', action: { kind: 'fold' } },
    ])
    const ann = publicEvidenceFromHand(bare, 'ann')
    expect(ann?.streets.flop.betWhenCheckedTo).toBe(1)
    expect(ann?.streets.flop.betSizes).toEqual({ small: 0, medium: 0, large: 0 })
    expect(publicEvidenceFromHand(bare, 'bea')?.streets.flop).toMatchObject({
      facedBet: 1,
      foldedToBet: 1,
      checkedTo: 0,
    })
    expect(publicBetSize(500, 0)).toBeNull()
    expect([
      publicBetSize(500, 1_000),
      publicBetSize(1_000, 1_000),
      publicBetSize(1_001, 1_000),
    ]).toEqual(['small', 'medium', 'large'])
  })
})

describe('pooled opponent statistics', () => {
  const tuning = {
    halfLifeMs: 1_000,
    priorStrength: 10,
    intervalZ: 1.645,
    priors: {
      vpip: 0.3,
      pfr: 0.18,
      foldToPreflopRaise: 0.5,
      foldToBet: 0.4,
      raiseVsBet: 0.1,
      betWhenCheckedTo: 0.35,
      riverBetWhenCheckedTo: 0.3,
    },
  }

  it('starts every rate at its prior and narrows it only with that rate’s own opportunities', () => {
    const empty = rateEstimate(0, 0, 0.4, tuning)
    expect(empty.mean).toBeCloseTo(0.4, 10)
    const two = rateEstimate(2, 2, 0.4, tuning)
    const forty = rateEstimate(40, 40, 0.4, tuning)
    expect(two.mean).toBeCloseTo(0.5, 10)
    expect(two.high - two.low).toBeGreaterThan(forty.high - forty.low)
    expect(forty.low).toBeGreaterThan(two.low)
    expect(forty.high).toBeLessThanOrEqual(1)
  })

  it('pools the postflop streets and keeps the river bet rate apart', () => {
    const ann = publicEvidenceFromHand(hand, 'ann', [parseCard('As'), parseCard('Ad')])
    if (ann === null) throw new Error('evidence missing')
    const state = updateOpponentStats(null, ann, 0, tuning)
    expect([state.facedBet, state.checkedTo, state.betWhenCheckedTo]).toEqual([1, 3, 1])
    expect([state.riverCheckedTo, state.riverBetWhenCheckedTo]).toEqual([1, 1])
    expect(state.shownRiverAggression).toEqual({ air: 0, pair: 0, made: 1 })
    const summary = summariseOpponentStats(state, tuning)
    expect(summary.betWhenCheckedTo.opportunities).toBe(3)
    expect(summary.foldToBet.mean).toBeCloseTo(4 / 11, 10)
  })

  it('halves old evidence after one half-life before adding the new hand', () => {
    const bea = publicEvidenceFromHand(hand, 'bea')
    if (bea === null) throw new Error('evidence missing')
    const first = updateOpponentStats(null, bea, 0, tuning)
    const later = updateOpponentStats(first, bea, 1_000, tuning)
    expect(later.hands).toBeCloseTo(1.5, 10)
    expect(later.facedBet).toBeCloseTo(first.facedBet * 1.5, 10)
  })
})
