import {
  type Card,
  type HandRecord,
  SHOWDOWN_SECOND_CARD_MS,
  SHOWDOWN_TENSION_MS,
} from '@river/engine'
import type { RoomEvent, RoomSeatView, RoomView } from '@river/server'
import { describe, expect, it } from 'vitest'
import { beforeAwards, cardsTurned, showdownPlanFor, showingSeat } from './showdown-plan'

const card = (text: string): Card => ({
  rank: text.slice(0, -1) as Card['rank'],
  suit: text.slice(-1) as Card['suit'],
})
const hand = (text: string): Card[] => text.split(' ').map(card)

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

/** The view that ends a hand at a showdown: seats 1, 2 and 4 show, seat 0 has the button. */
function ended(seats: RoomSeatView[] = []): RoomView {
  return {
    venueId: 'rooftop',
    handNumber: 3,
    phase: 'between',
    street: 'river',
    board: hand('Kd 8c 8s 3h 2c'),
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
    revealed: true,
    selfId: 'p0',
    hostPlayerId: 'p0',
    seats:
      seats.length > 0
        ? seats
        : [
            seat(0, { dealer: true }),
            seat(1, { hole: hand('Ks Kh') }),
            seat(2, { hole: hand('Ah Qd') }),
            seat(3),
            seat(4, { hole: hand('9s 9d') }),
          ],
  } as RoomView
}

function record(actions: HandRecord['actions']): HandRecord {
  return {
    handNumber: 3,
    startedAtMs: 0,
    stake: { smallBlind: 50, bigBlind: 100 },
    seats: [],
    actions,
    board: hand('Kd 8c 8s 3h 2c'),
    potSize: 1_200,
    results: [],
    commit: 'commit',
    revealedSeed: null,
  }
}

const settled = (actions: HandRecord['actions']): RoomEvent[] => [
  { kind: 'showdown', awards: [{ playerId: 'p1', amount: 1_200 }] },
  { kind: 'handRecorded', record: record(actions) },
]

describe('showdownPlanFor', () => {
  it('turns nothing over for a hand that ended without a showdown', () => {
    const events: RoomEvent[] = [{ kind: 'uncontested', playerId: 'p1', amount: 300 }]
    expect(showdownPlanFor(ended(), events, new Set())).toBeNull()
  })

  it('shows the last bettor on the river first, then round the table from them', () => {
    const plan = showdownPlanFor(
      ended(),
      settled([
        { seat: 1, street: 'flop', action: { kind: 'raiseTo', to: 200 } },
        { seat: 2, street: 'river', action: { kind: 'check' } },
        { seat: 4, street: 'river', action: { kind: 'raiseTo', to: 400 } },
        { seat: 1, street: 'river', action: { kind: 'call' } },
        { seat: 2, street: 'river', action: { kind: 'call' } },
      ]),
      new Set(),
    )
    expect(plan?.show.steps.map((step) => step.seat)).toEqual([4, 1, 2])
    expect(plan?.show.steps.map((step) => step.deciding)).toEqual([false, false, true])
  })

  it('starts left of the button when nobody bet on the river', () => {
    const plan = showdownPlanFor(
      ended(),
      settled([
        { seat: 4, street: 'turn', action: { kind: 'raiseTo', to: 400 } },
        { seat: 1, street: 'turn', action: { kind: 'call' } },
        { seat: 2, street: 'turn', action: { kind: 'call' } },
        { seat: 1, street: 'river', action: { kind: 'check' } },
        { seat: 2, street: 'river', action: { kind: 'check' } },
        { seat: 4, street: 'river', action: { kind: 'check' } },
      ]),
      new Set(),
    )
    expect(plan?.show.steps.map((step) => step.seat)).toEqual([1, 2, 4])
  })

  it('names each hand, and pays the pot only once the last hand is over', () => {
    const plan = showdownPlanFor(ended(), settled([]), new Set())
    expect(plan?.names.get(1)?.toLowerCase()).toBe('kings full of eights')
    expect(plan?.awards).toEqual([{ seat: 1, amount: 1_200 }])
    expect(plan?.pot).toBe(1_200)
    const last = plan?.show.steps.at(-1)
    expect(plan?.show.awardAtMs).toBeGreaterThan(last?.nameAtMs ?? Number.POSITIVE_INFINITY)
  })

  it('names a player who takes the main pot and a side pot once, with both', () => {
    const events: RoomEvent[] = [
      {
        kind: 'showdown',
        awards: [
          { playerId: 'p1', amount: 900 },
          { playerId: 'p2', amount: 0 },
          { playerId: 'p1', amount: 300 },
        ],
      },
      { kind: 'handRecorded', record: record([]) },
    ]
    const plan = showdownPlanFor(ended(), events, new Set())
    expect(plan?.awards).toEqual([{ seat: 1, amount: 1_200 }])
    expect(plan?.pot).toBe(1_200)
  })

  it('leaves out a seat that folded, even if the view still carries its cards', () => {
    const plan = showdownPlanFor(ended(), settled([]), new Set([4]))
    expect(plan?.show.steps.map((step) => step.seat)).toEqual([1, 2])
  })
})

describe('cardsTurned', () => {
  it('turns a hand over one card and then the other', () => {
    const plan = showdownPlanFor(ended(), settled([]), new Set())
    if (plan === null) throw new Error('expected a showdown')
    const first = plan.show.steps[0]
    if (first === undefined) throw new Error('expected a hand to show')
    expect(cardsTurned(plan, first.seat, first.revealAtMs - 1)).toBe(0)
    expect(cardsTurned(plan, first.seat, first.revealAtMs)).toBe(1)
    expect(cardsTurned(plan, first.seat, first.revealAtMs + SHOWDOWN_SECOND_CARD_MS)).toBe(2)
    expect(cardsTurned(plan, 3, plan.show.totalMs)).toBe(0)
  })
})

describe('beforeAwards', () => {
  it('takes the pot back off the winner and keeps the loser in until it is paid', () => {
    const view = ended([
      seat(0, { dealer: true, stack: 0, busted: true, sittingOut: true, hole: hand('2s 2d') }),
      seat(1, { stack: 21_200, hole: hand('Ks Kh') }),
    ])
    const plan = showdownPlanFor(view, settled([]), new Set())
    expect(plan).not.toBeNull()
    if (plan === null) return
    const before = beforeAwards(view, plan, { stacks: true })
    expect(before.pot).toBe(plan.pot)
    expect(before.seats.map((entry) => [entry.stack, entry.busted, entry.sittingOut])).toEqual([
      [0, false, false],
      [20_000, false, false],
    ])
    // Seats the showdown does not touch are passed through untouched.
    const table = ended()
    expect(beforeAwards(table, plan, { stacks: true }).seats[3]).toBe(table.seats[3])
    // The felt pays the winner itself; it only needs the loser kept in.
    expect(beforeAwards(view, plan, { stacks: false }).seats.map((entry) => entry.stack)).toEqual([
      0, 21_200,
    ])
  })
})

describe('a showdown after a run-out', () => {
  it('is told face up when the hands were tabled before the board was finished', () => {
    const runout: RoomEvent[] = [{ kind: 'street', street: 'river', cards: hand('2c') }]
    expect(showdownPlanFor(ended(), [...runout, ...settled([])], new Set())?.tabled).toBe(true)
    expect(showdownPlanFor(ended(), settled([]), new Set())?.tabled).toBe(false)
  })
})

describe('showingSeat', () => {
  it('follows each hand in turn and hands over to the award', () => {
    const plan = showdownPlanFor(ended(), settled([]), new Set())
    if (plan === null) throw new Error('expected a showdown')
    const [first, second] = plan.show.steps
    if (first === undefined || second === undefined) throw new Error('expected two hands')
    expect(showingSeat(plan, -1)).toBeNull()
    expect(showingSeat(plan, first.revealAtMs - 1)).toBeNull()
    expect(showingSeat(plan, first.revealAtMs)).toBe(first.seat)
    expect(showingSeat(plan, second.revealAtMs)).toBe(second.seat)
    expect(showingSeat(plan, plan.show.awardAtMs)).toBeNull()
  })

  it('looks at the deciding hand from the held breath before it', () => {
    const plan = showdownPlanFor(ended(), settled([]), new Set())
    if (plan === null) throw new Error('expected a showdown')
    const deciding = plan.show.steps.find((step) => step.deciding)
    if (deciding === undefined) throw new Error('expected a deciding hand')
    expect(showingSeat(plan, deciding.revealAtMs - SHOWDOWN_TENSION_MS)).toBe(deciding.seat)
  })
})
