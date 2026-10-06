import { describe, expect, it } from 'vitest'
import type { Street } from './betting.js'
import type { Card } from './cards.js'
import type { HandRecord } from './hand-history.js'
import { conservesChips, formatHandLine, summariseHand } from './hand-history.js'
import type { TurnAction } from './session.js'

const ACE_SPADES: Card = { rank: 'A', suit: 's' }
const KING_HEARTS: Card = { rank: 'K', suit: 'h' }

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
  const action: TurnAction = kind === 'raiseTo' ? { kind: 'raiseTo', to: to ?? 0 } : { kind }
  return { seat, street, action }
}

function record(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 1,
    startedAtMs: 1_700_000_000_000,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 100_000 },
      { seat: 1, playerId: 'bob', startingStack: 100_000 },
    ],
    actions: [action(0, 'preflop', 'call'), action(1, 'preflop', 'check')],
    board: [ACE_SPADES, KING_HEARTS],
    potSize: 1000,
    results: [
      { seat: 0, delta: 500, showed: false },
      { seat: 1, delta: -500, showed: false },
    ],
    commit: 'c1',
    revealedSeed: null,
    ...overrides,
  }
}

describe('conservesChips', () => {
  it('is true when deltas sum to zero', () => {
    expect(conservesChips(record())).toBe(true)
  })

  it('is false when deltas do not sum to zero', () => {
    const corrupt = record({
      results: [
        { seat: 0, delta: 600, showed: false },
        { seat: 1, delta: -500, showed: false },
      ],
    })
    expect(conservesChips(corrupt)).toBe(false)
  })

  it('is true for an empty result list', () => {
    expect(conservesChips(record({ results: [] }))).toBe(true)
  })
})

describe('summariseHand', () => {
  it('reports pre-flop for a hand that never left it', () => {
    const summary = summariseHand(record({ actions: [action(0, 'preflop', 'fold')] }))
    expect(summary.finalStreet).toBe('preflop')
  })

  it('reports river for a hand that reached it', () => {
    const actions = [
      action(0, 'preflop', 'call'),
      action(1, 'preflop', 'call'),
      action(0, 'flop', 'check'),
      action(1, 'flop', 'check'),
      action(0, 'turn', 'check'),
      action(1, 'turn', 'check'),
      action(0, 'river', 'check'),
      action(1, 'river', 'call'),
    ]
    const summary = summariseHand(record({ actions }))
    expect(summary.finalStreet).toBe('river')
  })

  it('reports no showdown when every result is a fold', () => {
    const summary = summariseHand(record())
    expect(summary.wentToShowdown).toBe(false)
  })

  it('reports all winners in a split pot', () => {
    const split = record({
      results: [
        { seat: 0, delta: 250, showed: true },
        { seat: 1, delta: 250, showed: true },
      ],
    })
    const summary = summariseHand(split)
    expect(summary.winnerSeats).toEqual([0, 1])
  })

  it('handles an empty action list without throwing', () => {
    const summary = summariseHand(record({ actions: [] }))
    expect(summary.actionCount).toBe(0)
    expect(summary.finalStreet).toBeNull()
  })

  it('handles an empty result list without throwing', () => {
    const summary = summariseHand(record({ results: [] }))
    expect(summary.winnerSeats).toEqual([])
    expect(summary.wentToShowdown).toBe(false)
  })

  it('reports the pot the table recorded rather than deriving it from deltas', () => {
    const threeWay = record({
      seats: [
        { seat: 0, playerId: 'alice', startingStack: 100_000 },
        { seat: 1, playerId: 'bob', startingStack: 100_000 },
        { seat: 2, playerId: 'carol', startingStack: 100_000 },
      ],
      potSize: 3000,
      results: [
        { seat: 0, delta: 2000, showed: true },
        { seat: 1, delta: -1000, showed: true },
        { seat: 2, delta: -1000, showed: false },
      ],
    })
    expect(summariseHand(threeWay).potSize).toBe(3000)
  })

  it('summarises two identical records identically', () => {
    expect(summariseHand(record())).toEqual(summariseHand(record()))
  })
})

describe('formatHandLine', () => {
  it('names the requested seats own result, not another seat', () => {
    const line = formatHandLine(record(), 0)
    expect(line).toContain('alice')
    expect(line).toContain('won 500')
    expect(line).not.toContain('bob')
  })

  it('reports a loss for the losing seat', () => {
    const line = formatHandLine(record(), 1)
    expect(line).toContain('bob')
    expect(line).toContain('lost 500')
  })

  it('handles a missing result gracefully', () => {
    const line = formatHandLine(record({ results: [] }), 2)
    expect(line).toContain('no result')
  })
})
