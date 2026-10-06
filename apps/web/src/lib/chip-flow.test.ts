import type { RoomEvent, RoomSeatView, RoomView } from '@river/server'
import { describe, expect, it } from 'vitest'
import {
  AWARD_SECONDS,
  applyMoment,
  betsAt,
  type ChipFlow,
  chipMomentFor,
  emptyChipFlow,
  flightProgress,
  flightsAt,
  potAt,
  SWEEP_SECONDS,
  settleChipFlow,
  stackAdjustmentAt,
} from './chip-flow'

function seat(index: number, overrides: Partial<RoomSeatView> = {}): RoomSeatView {
  return {
    seat: index,
    playerId: `p${index}`,
    name: `P${index}`,
    stack: 10_000,
    betHand: 0,
    betStreet: 0,
    folded: false,
    allIn: false,
    hole: null,
    hasHole: true,
    sittingOut: false,
    busted: false,
    disconnected: false,
    dealer: false,
    ...overrides,
  }
}

function view(overrides: Partial<RoomView> & { seats: RoomSeatView[] }): RoomView {
  return {
    venueId: 'rooftop',
    handNumber: 1,
    phase: 'hand',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    currentActor: null,
    legal: null,
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId: 'p0',
    hostPlayerId: 'p0',
    ...overrides,
  } as RoomView
}

const acted = (playerId: string, kind: 'call' | 'raiseTo' | 'allIn'): RoomEvent =>
  (kind === 'raiseTo'
    ? { kind: 'acted', playerId, action: { kind, to: 1_000 } }
    : { kind: 'acted', playerId, action: { kind } }) as RoomEvent

/** Run a flow forward until everything has landed. */
function settled(flow: ChipFlow): ChipFlow {
  return settleChipFlow(flow, 1_000)
}

describe('what moved', () => {
  it('moves nothing on the first view a client sees, and says where things are', () => {
    const next = view({
      pot: 300,
      seats: [seat(0, { betHand: 100, betStreet: 100 }), seat(1, { betHand: 200, betStreet: 200 })],
    })
    const moment = chipMomentFor(null, next, [], 1)
    expect(moment.commits).toEqual([])
    expect(moment.sweep).toBe(false)
    expect(moment.truth).toEqual({
      bets: [
        { seat: 0, amount: 100 },
        { seat: 1, amount: 200 },
      ],
      pot: 0,
    })
  })

  it('puts the blinds on the line when a hand is dealt', () => {
    const before = view({ phase: 'between', handNumber: 1, seats: [seat(0), seat(1)] })
    const after = view({
      handNumber: 2,
      pot: 150,
      seats: [seat(0, { betHand: 50, betStreet: 50 }), seat(1, { betHand: 100, betStreet: 100 })],
    })
    const moment = chipMomentFor(before, after, [], 1)
    expect(moment.commits).toEqual([
      { seat: 0, amount: 50, path: 'push' },
      { seat: 1, amount: 100, path: 'push' },
    ])
    expect(moment.sweep).toBe(false)
  })

  it('catches the call that closes a round, which never shows as a bet', () => {
    // Seat 0 bet 400 on the flop and seat 1 called. The call ends the round in the same
    // message, so the next view already has every bet back at zero for the turn.
    const before = view({
      street: 'flop',
      pot: 1_400,
      seats: [seat(0, { betHand: 900, betStreet: 400 }), seat(1, { betHand: 500 })],
    })
    const after = view({
      street: 'turn',
      pot: 1_800,
      seats: [seat(0, { betHand: 900 }), seat(1, { betHand: 900 })],
    })
    const moment = chipMomentFor(before, after, [acted('p1', 'call')], 1)
    expect(moment.commits).toEqual([{ seat: 1, amount: 400, path: 'push' }])
    expect(moment.sweep).toBe(true)
    expect(moment.truth).toEqual({ bets: [], pot: 1_800 })
  })

  it('carries an all-in on the shove rather than the push', () => {
    const before = view({ seats: [seat(0, { betHand: 100, betStreet: 100 }), seat(1)] })
    const after = view({
      seats: [
        seat(0, { betHand: 100, betStreet: 100 }),
        seat(1, { betHand: 5_000, betStreet: 5_000 }),
      ],
    })
    expect(chipMomentFor(before, after, [acted('p1', 'allIn')], 1).commits).toEqual([
      { seat: 1, amount: 5_000, path: 'shove' },
    ])
  })

  it('works out the last chips in, and the payout, from the record when the hand ends', () => {
    // River: seat 0 bets 1,000 into 2,000 and seat 1 calls and wins. The view that ends the
    // hand has no bets and no pot left in it to read.
    const before = view({
      street: 'river',
      pot: 3_000,
      seats: [seat(0, { betHand: 2_000, betStreet: 1_000 }), seat(1, { betHand: 1_000 })],
    })
    const after = view({ phase: 'between', street: 'river', pot: 0, seats: [seat(0), seat(1)] })
    const events = [
      acted('p1', 'call'),
      { kind: 'showdown', awards: [{ playerId: 'p1', amount: 4_000 }] },
      {
        kind: 'handRecorded',
        record: {
          results: [
            { seat: 0, delta: -2_000, showed: true },
            { seat: 1, delta: 2_000, showed: true },
          ],
        },
      },
    ] as RoomEvent[]
    const moment = chipMomentFor(before, after, events, 1)
    expect(moment.commits).toEqual([{ seat: 1, amount: 1_000, path: 'push' }])
    expect(moment.sweep).toBe(true)
    expect(moment.awards).toEqual([{ seat: 1, amount: 4_000 }])
  })
})

describe('flying the chips', () => {
  it('lifts a bet off the stack with the hand, and lands it on the line', () => {
    const moment = {
      serial: 1,
      handNumber: 1,
      commits: [{ seat: 0, amount: 500, path: 'push' as const }],
      sweep: false,
      awards: [],
      truth: { bets: [{ seat: 0, amount: 500 }], pot: 0 },
    }
    const flow = applyMoment(emptyChipFlow(), moment, 10)
    const [flight] = flow.flights
    if (flight === undefined) throw new Error('expected a flight')
    // Still in the stack until the hand reaches it.
    expect(flightProgress(flight, 10.05)).toBe(0)
    expect(stackAdjustmentAt(flow, 0, 10.05)).toBe(500)
    expect(flightsAt(flow, 10.05)).toEqual([])
    // Moving with the hand, then down.
    expect(flightProgress(flight, 10.3)).toBeGreaterThan(0)
    expect(flightsAt(flow, 10.3)).toHaveLength(1)
    expect(betsAt(flow, 10.3).get(0)).toBeUndefined()
    expect(betsAt(flow, flight.landAt).get(0)).toBe(500)
  })

  it('sweeps the lines only after the last chips are down, and pays out after the sweep', () => {
    const moment = {
      serial: 1,
      handNumber: 1,
      commits: [{ seat: 1, amount: 1_000, path: 'push' as const }],
      sweep: true,
      awards: [{ seat: 1, amount: 4_000 }],
      truth: { bets: [], pot: 0 },
    }
    const start = { ...emptyChipFlow(), base: { bets: new Map([[0, 1_000]]), pot: 2_000 } }
    const flow = applyMoment(start, moment, 0)
    const commit = flow.flights.find((flight) => flight.from.kind === 'stack')
    const sweeps = flow.flights.filter((flight) => flight.to.kind === 'pot')
    const award = flow.flights.find((flight) => flight.from.kind === 'pot')
    if (commit === undefined || award === undefined) throw new Error('expected flights')
    // Both lines go in, including the call that has not landed yet.
    expect(sweeps.map((flight) => [flight.from.seat, flight.amount]).sort()).toEqual([
      [0, 1_000],
      [1, 1_000],
    ])
    for (const sweep of sweeps) expect(sweep.startAt).toBeGreaterThan(commit.landAt)
    expect(award.startAt).toBeGreaterThan(Math.max(...sweeps.map((flight) => flight.landAt)))
    expect(award.landAt - award.startAt).toBeCloseTo(AWARD_SECONDS, 6)
    // The pot fills as the sweep lands and empties as the payout leaves.
    const swept = Math.max(...sweeps.map((flight) => flight.landAt))
    expect(potAt(flow, swept)).toBe(4_000)
    expect(potAt(flow, award.startAt)).toBe(0)
    // The winner's stack grows when the chips arrive, not when the view says so.
    expect(stackAdjustmentAt(flow, 1, award.startAt)).toBe(-4_000)
    expect(stackAdjustmentAt(flow, 1, award.landAt)).toBe(0)
  })

  it('settles on what the view says once everything has landed', () => {
    const moment = {
      serial: 1,
      handNumber: 1,
      commits: [],
      sweep: true,
      awards: [],
      truth: { bets: [], pot: 2_500 },
    }
    const start = { ...emptyChipFlow(), base: { bets: new Map([[0, 400]]), pot: 2_000 } }
    const flow = settled(applyMoment(start, moment, 0))
    expect(flow.flights).toEqual([])
    // 2,000 in the middle plus the 400 swept is 2,400, and the view says 2,500. The view wins.
    expect(flow.base.pot).toBe(2_500)
    expect(flow.base.bets.size).toBe(0)
  })

  it('applies a moment once, however often the running list is read', () => {
    const moment = {
      serial: 3,
      handNumber: 1,
      commits: [{ seat: 0, amount: 100, path: 'push' as const }],
      sweep: false,
      awards: [],
      truth: { bets: [{ seat: 0, amount: 100 }], pot: 0 },
    }
    const once = applyMoment(emptyChipFlow(), moment, 0)
    expect(applyMoment(once, moment, 1)).toBe(once)
  })

  it('slides a sweep with both ends eased', () => {
    const moment = {
      serial: 1,
      handNumber: 1,
      commits: [],
      sweep: true,
      awards: [],
      truth: { bets: [], pot: 100 },
    }
    const start = { ...emptyChipFlow(), base: { bets: new Map([[0, 100]]), pot: 0 } }
    const [sweep] = applyMoment(start, moment, 0).flights
    if (sweep === undefined) throw new Error('expected a sweep')
    expect(sweep.landAt - sweep.startAt).toBeCloseTo(SWEEP_SECONDS, 6)
    const early = flightProgress(sweep, sweep.startAt + SWEEP_SECONDS * 0.1)
    const middle = flightProgress(sweep, sweep.startAt + SWEEP_SECONDS * 0.5)
    expect(early).toBeLessThan(0.1)
    expect(middle).toBeCloseTo(0.5, 6)
  })
})
