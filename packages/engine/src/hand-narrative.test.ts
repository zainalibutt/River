import { describe, expect, it } from 'vitest'
import type { Street } from './betting.js'
import type { HandRecord } from './hand-history.js'
import { actionSummary, describeShowdown, narrateHand } from './hand-narrative.js'
import type { TurnAction } from './session.js'

function action(
  seat: number,
  street: Street,
  kind: TurnAction['kind'],
  to?: number,
): {
  seat: number
  street: Street
  action: TurnAction
} {
  const value: TurnAction = kind === 'raiseTo' ? { kind: 'raiseTo', to: to ?? 0 } : { kind }
  return { seat, street, action: value }
}

function record(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 7,
    startedAtMs: 1_700_000_000_000,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 100_000 },
      { seat: 1, playerId: 'bob', startingStack: 100_000 },
      { seat: 2, playerId: 'charlie', startingStack: 100_000 },
    ],
    actions: [
      action(0, 'preflop', 'raiseTo', 1500),
      action(1, 'preflop', 'fold'),
      action(2, 'preflop', 'call'),
    ],
    board: [],
    potSize: 3500,
    results: [
      { seat: 0, delta: 1500, showed: false },
      { seat: 2, delta: -1500, showed: false },
    ],
    commit: 'abc',
    revealedSeed: null,
    ...overrides,
  }
}

describe('narrateHand', () => {
  it('says a seat not dealt in was watching from the rail', () => {
    const hand = record()
    expect(narrateHand(hand, 5)).toBe('Watched this one from the rail.')
  })

  it('narrates a fold before the flop', () => {
    const hand = record({
      actions: [action(1, 'preflop', 'fold')],
      results: [
        { seat: 0, delta: 500, showed: false },
        { seat: 1, delta: -500, showed: false },
      ],
    })
    expect(narrateHand(hand, 1)).toBe('Folded before the flop.')
  })

  it('narrates a fold to a raise before the flop', () => {
    const hand = record({
      actions: [
        action(0, 'preflop', 'raiseTo', 1500),
        action(1, 'preflop', 'call'),
        action(2, 'preflop', 'fold'),
      ],
      results: [
        { seat: 0, delta: 1500, showed: false },
        { seat: 1, delta: -1000, showed: false },
      ],
    })
    expect(narrateHand(hand, 2)).toBe('Folded to a raise before the flop.')
  })

  it('narrates an uncontested win with the amount', () => {
    const hand = record({
      actions: [action(0, 'preflop', 'raiseTo', 4500), action(1, 'preflop', 'fold')],
      results: [{ seat: 0, delta: 4500, showed: false }],
    })
    expect(narrateHand(hand, 0)).toBe('Raised preflop, won 4,500 uncontested before the flop.')
  })

  it('narrates a showdown loss', () => {
    const hand = record({
      actions: [
        action(0, 'preflop', 'call'),
        action(1, 'preflop', 'check'),
        action(0, 'turn', 'check'),
        action(1, 'turn', 'check'),
      ],
      results: [
        { seat: 0, delta: -500, showed: true },
        { seat: 1, delta: 500, showed: true },
      ],
    })
    expect(narrateHand(hand, 0)).toBe(
      'Called preflop, played to the turn, lost 500 at the showdown.',
    )
  })

  it('handles a hand with zero actions without throwing', () => {
    const hand = record({ actions: [], results: [] })
    expect(narrateHand(hand, 0)).toBe('Broke even before the flop.')
  })

  it('is deterministic across repeated calls', () => {
    const hand = record()
    const first = narrateHand(hand, 0)
    const second = narrateHand(hand, 0)
    expect(second).toBe(first)
  })

  it('formats 1,000, 12,500 and 1,234,567 with thousands separators', () => {
    const thousand = narrateHand(record({ results: [{ seat: 0, delta: 1000, showed: false }] }), 0)
    expect(thousand).toContain('1,000')
    const twelve = narrateHand(record({ results: [{ seat: 0, delta: 12_500, showed: false }] }), 0)
    expect(twelve).toContain('12,500')
    const million = narrateHand(
      record({ results: [{ seat: 0, delta: 1_234_567, showed: false }] }),
      0,
    )
    expect(million).toContain('1,234,567')
  })
})

describe('describeShowdown', () => {
  it('describes only the seats that showed, with hand null because hole cards are not recorded', () => {
    const hand = record({
      results: [
        { seat: 0, delta: 2500, showed: true },
        { seat: 1, delta: -2500, showed: true },
        { seat: 2, delta: 0, showed: false },
      ],
    })
    const lines = describeShowdown(hand)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.seat).toBe(0)
    expect(lines[0]?.hand).toBeNull()
    expect(lines[0]?.won).toBe(true)
    expect(lines[1]?.seat).toBe(1)
    expect(lines[1]?.hand).toBeNull()
    expect(lines[1]?.won).toBe(false)
  })

  it('returns an empty list when nobody shows', () => {
    expect(describeShowdown(record())).toHaveLength(0)
  })
})

describe('actionSummary', () => {
  it('reports vpip false for an unraised blind that checks and folds', () => {
    const hand = record({
      actions: [
        action(1, 'preflop', 'check'),
        action(0, 'preflop', 'check'),
        action(1, 'flop', 'check'),
        action(0, 'flop', 'raiseTo', 1000),
        action(1, 'flop', 'fold'),
      ],
      results: [{ seat: 0, delta: 2000, showed: false }],
    })
    const summary = actionSummary(hand, 1)
    expect(summary.vpip).toBe(false)
    expect(summary.raises).toBe(0)
    expect(summary.folded).toBe(true)
    expect(summary.streetsSeen).toBe(2)
  })

  it('reports vpip true for a seat that called preflop', () => {
    const hand = record({ actions: [action(0, 'preflop', 'raiseTo', 1000)] })
    const summary = actionSummary(hand, 0)
    expect(summary.vpip).toBe(true)
    expect(summary.raises).toBe(1)
  })

  it('counts raises across the hand', () => {
    const hand = record({
      actions: [action(0, 'preflop', 'raiseTo', 1000), action(0, 'flop', 'raiseTo', 2000)],
    })
    expect(actionSummary(hand, 0).raises).toBe(2)
  })

  it('reports zero for a seat not dealt in', () => {
    const summary = actionSummary(record(), 9)
    expect(summary).toEqual({ vpip: false, raises: 0, folded: false, streetsSeen: 0 })
  })
})
