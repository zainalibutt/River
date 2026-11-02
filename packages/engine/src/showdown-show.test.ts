import { describe, expect, it } from 'vitest'
import { parseCard } from './cards.js'
import { evaluateBest } from './evaluator.js'
import type { HandRecord } from './hand-history.js'
import {
  SHOWDOWN_HUSH_MS,
  SHOWDOWN_MUCK_MS,
  SHOWDOWN_SECOND_CARD_MS,
  SHOWDOWN_STEP_MS,
  SHOWDOWN_TABLED_HUSH_MS,
  SHOWDOWN_TABLED_STEP_MS,
  SHOWDOWN_TENSION_MS,
  showdownOrder,
  showdownPresentationMs,
  showdownReveals,
  showdownShow,
} from './showdown-show.js'

function record(actions: HandRecord['actions']): HandRecord {
  return {
    handNumber: 1,
    startedAtMs: 0,
    stake: { smallBlind: 50, bigBlind: 100 },
    seats: [],
    actions,
    board: [],
    potSize: 0,
    results: [],
    commit: '',
    revealedSeed: null,
  }
}

describe('showdown order', () => {
  it('shows the last player to bet on the river first, then round the table', () => {
    const order = showdownOrder({
      record: record([
        { seat: 2, street: 'river', action: { kind: 'check' } },
        { seat: 5, street: 'river', action: { kind: 'raiseTo', to: 800 } },
        { seat: 7, street: 'river', action: { kind: 'call' } },
        { seat: 2, street: 'river', action: { kind: 'call' } },
      ]),
      shownSeats: [2, 5, 7],
      dealerSeat: 0,
      seatCount: 9,
    })
    expect(order).toEqual([5, 7, 2])
  })

  it('starts left of the button when the river was checked round', () => {
    const order = showdownOrder({
      record: record([
        { seat: 1, street: 'turn', action: { kind: 'raiseTo', to: 400 } },
        { seat: 6, street: 'turn', action: { kind: 'call' } },
        { seat: 6, street: 'river', action: { kind: 'check' } },
        { seat: 1, street: 'river', action: { kind: 'check' } },
      ]),
      shownSeats: [1, 6],
      dealerSeat: 4,
      seatCount: 9,
    })
    // A turn bet does not decide who shows first: the final round was checked.
    expect(order).toEqual([6, 1])
  })

  it('takes the final round as the last street acted on when the hand was all in early', () => {
    const order = showdownOrder({
      record: record([
        { seat: 3, street: 'flop', action: { kind: 'allIn' } },
        { seat: 8, street: 'flop', action: { kind: 'call' } },
      ]),
      shownSeats: [3, 8],
      dealerSeat: 5,
      seatCount: 9,
    })
    expect(order).toEqual([3, 8])
  })

  it('wraps round past the last seat', () => {
    const order = showdownOrder({
      record: record([]),
      shownSeats: [0, 7],
      dealerSeat: 7,
      seatCount: 9,
    })
    expect(order).toEqual([0, 7])
  })
})

describe('showdown schedule', () => {
  it('goes quiet first, then turns the hands over one at a time, card by card', () => {
    const show = showdownShow([4, 1])
    const [first, second] = show.steps
    expect(first?.revealAtMs).toBe(SHOWDOWN_HUSH_MS)
    expect(first?.secondCardAtMs).toBe(SHOWDOWN_HUSH_MS + SHOWDOWN_SECOND_CARD_MS)
    expect(second?.revealAtMs).toBeGreaterThan((first?.revealAtMs ?? 0) + SHOWDOWN_STEP_MS)
  })

  it('holds its breath before the hand that decides it, and only that one', () => {
    const show = showdownShow([4, 1, 6])
    expect(show.steps.map((step) => step.deciding)).toEqual([false, false, true])
    const gap = (show.steps[2]?.revealAtMs ?? 0) - (show.steps[1]?.revealAtMs ?? 0)
    expect(gap).toBe(SHOWDOWN_STEP_MS + SHOWDOWN_TENSION_MS)
  })

  it('pays out after the last hand is read', () => {
    const show = showdownShow([4, 1])
    const last = show.steps[show.steps.length - 1]
    expect(show.awardAtMs).toBeGreaterThan(last?.nameAtMs ?? 0)
    expect(show.totalMs).toBeGreaterThan(show.awardAtMs)
  })

  it('tells the server how long to hold the next deal', () => {
    expect(showdownPresentationMs(0)).toBe(0)
    expect(showdownPresentationMs(2)).toBe(showdownShow([0, 1]).totalMs)
    expect(showdownPresentationMs(3)).toBeGreaterThan(showdownPresentationMs(2))
  })
})

describe('a tabled showdown', () => {
  it('names hands already face up, with no hush, second card or held breath', () => {
    const show = showdownShow([4, 1, 6], { tabled: true })
    expect(show.steps.map((step) => step.revealAtMs)).toEqual([
      SHOWDOWN_TABLED_HUSH_MS,
      SHOWDOWN_TABLED_HUSH_MS + SHOWDOWN_TABLED_STEP_MS,
      SHOWDOWN_TABLED_HUSH_MS + 2 * SHOWDOWN_TABLED_STEP_MS,
    ])
    expect(show.steps.every((step) => step.secondCardAtMs === step.revealAtMs)).toBe(true)
    expect(show.totalMs).toBeLessThan(showdownShow([4, 1, 6]).totalMs)
    expect(showdownPresentationMs(3, { tabled: true })).toBe(show.totalMs)
  })
})

describe('a mucked hand', () => {
  it('takes a short turn and turns nothing over', () => {
    const show = showdownShow([4, 1, 6], { mucked: new Set([1]) })
    const [, mucked, last] = show.steps
    expect(mucked?.mucked).toBe(true)
    expect((last?.revealAtMs ?? 0) - (mucked?.revealAtMs ?? 0)).toBe(
      SHOWDOWN_MUCK_MS + SHOWDOWN_TENSION_MS,
    )
    expect(showdownPresentationMs(2, { mucked: 1 })).toBe(show.totalMs)
  })
})

describe('who shows at a showdown', () => {
  const rank = (text: string) => evaluateBest(text.split(' ').map((token) => parseCard(token)))
  const board = 'Kd 8c 8s 3h 2c'
  const ranks = new Map([
    [1, rank(`Ah Qd ${board}`)],
    [2, rank(`Ks Kh ${board}`)],
    [4, rank(`9s 9d ${board}`)],
    [6, rank(`Ac Kc ${board}`)],
  ])

  it('shows a hand only when it beats or ties the best already shown', () => {
    // Seat 1 shows first; seat 2's full house beats it; seat 4's nines and seat 6's kings
    // cannot beat that, so both are thrown away.
    const shown = showdownReveals({
      order: [1, 2, 4, 6],
      ranks,
      allIn: false,
      alwaysShow: new Set(),
    })
    expect([...shown]).toEqual([1, 2])
  })

  it('tables every hand when somebody is all in', () => {
    const shown = showdownReveals({
      order: [1, 2, 4, 6],
      ranks,
      allIn: true,
      alwaysShow: new Set(),
    })
    expect([...shown]).toEqual([1, 2, 4, 6])
  })

  it('shows a losing hand for a player who always shows', () => {
    const shown = showdownReveals({
      order: [1, 2, 4, 6],
      ranks,
      allIn: false,
      alwaysShow: new Set([4]),
    })
    expect([...shown]).toEqual([1, 2, 4])
  })
})
