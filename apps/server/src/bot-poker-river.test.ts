import { type BotObservationV1, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { riverCallDecision } from './bot-poker-river.js'

function observation(hole: readonly [string, string], board: readonly string[]): BotObservationV1 {
  return {
    version: 1,
    roomId: 'river-fixture',
    handNumber: 1,
    actor: {
      playerId: 'bot:og',
      seat: 0,
      hole: hole.map(parseCard),
      stack: 10_000,
      betHand: 500,
      betStreet: 0,
    },
    street: 'river',
    board: board.map(parseCard),
    pot: 2_000,
    currentBet: 500,
    amountToCall: 500,
    legal: {
      fold: true,
      check: false,
      call: { enabled: true, amount: 500 },
      raiseTo: { enabled: true, min: 1_000, max: 10_000 },
      allIn: { enabled: true, amount: 10_000 },
    },
    seats: [
      {
        seat: 0,
        playerId: 'bot:og',
        stack: 10_000,
        betHand: 500,
        betStreet: 0,
        folded: false,
        allIn: false,
        away: false,
      },
      {
        seat: 1,
        playerId: 'human',
        stack: 10_000,
        betHand: 500,
        betStreet: 500,
        folded: false,
        allIn: false,
        away: false,
      },
    ],
    opponents: [],
    actions: [],
    tilt: { factor: 0 },
  }
}

describe('offline OG river candidate', () => {
  it('calls a folded private royal when all ranges beat the price', () => {
    const state = observation(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2h', '3c'])
    expect(riverCallDecision(state, { kind: 'fold' })).toEqual({ kind: 'call' })
  })

  it('folds a hopeless expensive call when all ranges miss the price', () => {
    const state = observation(['2c', '3d'], ['As', 'Kh', 'Qc', 'Jd', '9h'])
    const expensive = {
      ...state,
      pot: 500,
      amountToCall: 5_000,
      legal: { ...state.legal, call: { enabled: true, amount: 5_000 } },
    }
    expect(riverCallDecision(expensive, { kind: 'call' })).toEqual({ kind: 'fold' })
  })

  it('preserves baseline for multiway, all-in, ambiguous or unsupported decisions', () => {
    const state = observation(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2h', '3c'])
    const baseline = { kind: 'fold' } as const
    const actorSeat = state.seats[0]
    const opponentSeat = state.seats[1]
    if (actorSeat === undefined || opponentSeat === undefined)
      throw new Error('fixture seats missing')
    const { actions: _actions, ...withoutActions } = state
    expect(riverCallDecision(withoutActions, baseline)).toEqual(baseline)
    expect(riverCallDecision({ ...state, street: 'turn' }, baseline)).toEqual(baseline)
    expect(
      riverCallDecision(
        { ...state, seats: [...state.seats, { ...opponentSeat, seat: 2, playerId: 'other' }] },
        baseline,
      ),
    ).toEqual(baseline)
    expect(
      riverCallDecision(
        { ...state, seats: [actorSeat, { ...opponentSeat, allIn: true }] },
        baseline,
      ),
    ).toEqual(baseline)
    expect(riverCallDecision(state, { kind: 'raiseTo', to: 1_000 })).toEqual({
      kind: 'raiseTo',
      to: 1_000,
    })
  })
})
