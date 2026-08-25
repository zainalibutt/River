import type { Card, HandRecord } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  formatChips,
  handsPlayed,
  historyRows,
  netChips,
  outcomeLabel,
  showdownPercent,
  streetLabel,
} from './history'

const ACE: Card = { rank: 'A', suit: 's' }
const KING: Card = { rank: 'K', suit: 'h' }
const QUEEN: Card = { rank: 'Q', suit: 'd' }

function record(overrides: Partial<HandRecord> = {}): HandRecord {
  return {
    handNumber: 1,
    startedAtMs: 1_700_000_000_000,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 100_000 },
      { seat: 1, playerId: 'bob', startingStack: 100_000 },
    ],
    actions: [
      { seat: 0, street: 'preflop', action: { kind: 'call' } },
      { seat: 1, street: 'flop', action: { kind: 'check' } },
    ],
    board: [ACE, KING, QUEEN],
    potSize: 1_000,
    results: [
      { seat: 0, delta: 500, showed: true },
      { seat: 1, delta: -500, showed: true },
    ],
    commit: 'commit-1',
    revealedSeed: 'seed-1',
    ...overrides,
  }
}

describe('historyRows', () => {
  it('tells the hand from the asking player side', () => {
    const [forAlice] = historyRows([record()], 'alice')
    const [forBob] = historyRows([record()], 'bob')
    expect(forAlice?.outcome).toBe('won')
    expect(forAlice?.deltaChips).toBe(500)
    expect(forBob?.outcome).toBe('lost')
    expect(forBob?.deltaChips).toBe(-500)
  })

  it('reports the pot the table counted, not the sum of the deltas', () => {
    const threeWay = record({
      seats: [
        { seat: 0, playerId: 'alice', startingStack: 100_000 },
        { seat: 1, playerId: 'bob', startingStack: 100_000 },
        { seat: 2, playerId: 'cara', startingStack: 100_000 },
      ],
      potSize: 1_500,
      results: [
        { seat: 0, delta: 1_000, showed: true },
        { seat: 1, delta: -500, showed: false },
        { seat: 2, delta: -500, showed: false },
      ],
    })
    expect(historyRows([threeWay], 'alice')[0]?.potChips).toBe(1_500)
  })

  it('marks a hand the player was not dealt into as away rather than a loss', () => {
    const [row] = historyRows([record()], 'cara')
    expect(row?.outcome).toBe('away')
    expect(row?.deltaChips).toBe(0)
    expect(outcomeLabel(row as NonNullable<typeof row>)).toBe('Not dealt in')
  })

  it('follows a player who changed seats between hands', () => {
    const moved = record({
      handNumber: 2,
      seats: [
        { seat: 3, playerId: 'alice', startingStack: 90_000 },
        { seat: 4, playerId: 'bob', startingStack: 110_000 },
      ],
      results: [
        { seat: 3, delta: -750, showed: false },
        { seat: 4, delta: 750, showed: false },
      ],
    })
    const rows = historyRows([record(), moved], 'alice')
    expect(rows.map((row) => row.outcome)).toEqual(['won', 'lost'])
    expect(netChips(rows)).toBe(-250)
  })

  it('reports the last street any action reached', () => {
    expect(historyRows([record()], 'alice')[0]?.street).toBe('flop')
    expect(historyRows([record({ actions: [] })], 'alice')[0]?.street).toBe('preflop')
  })

  it('calls a hand unverifiable until its seed is revealed', () => {
    expect(historyRows([record({ revealedSeed: null })], 'alice')[0]?.verifiable).toBe(false)
    expect(historyRows([record()], 'alice')[0]?.verifiable).toBe(true)
  })

  it('reads a showdown off whether anyone actually showed', () => {
    const folded = record({
      results: [
        { seat: 0, delta: 500, showed: false },
        { seat: 1, delta: -500, showed: false },
      ],
    })
    expect(historyRows([folded], 'alice')[0]?.showdown).toBe(false)
    expect(historyRows([record()], 'alice')[0]?.showdown).toBe(true)
  })

  it('returns nothing for an empty history', () => {
    expect(historyRows([], 'alice')).toEqual([])
  })
})

describe('session lines', () => {
  const rows = historyRows(
    [
      record({ handNumber: 1 }),
      record({
        handNumber: 2,
        results: [
          { seat: 0, delta: -2_000, showed: false },
          { seat: 1, delta: 2_000, showed: false },
        ],
      }),
      record({ handNumber: 3, seats: [{ seat: 5, playerId: 'dan', startingStack: 1 }] }),
    ],
    'alice',
  )

  it('nets only what this player won and lost', () => {
    expect(netChips(rows)).toBe(-1_500)
  })

  it('counts only the hands the player was dealt into', () => {
    expect(handsPlayed(rows)).toBe(2)
  })

  it('measures showdown share against hands played, not hands watched', () => {
    expect(showdownPercent(rows)).toBe(50)
  })

  it('has no showdown share before a hand is played', () => {
    expect(showdownPercent([])).toBeNull()
    expect(showdownPercent(historyRows([record()], 'nobody'))).toBeNull()
  })
})

describe('labels', () => {
  it('names a loss without a minus sign', () => {
    const [row] = historyRows(
      [
        record({
          results: [
            { seat: 0, delta: -12_500, showed: false },
            { seat: 1, delta: 12_500, showed: false },
          ],
        }),
      ],
      'alice',
    )
    expect(outcomeLabel(row as NonNullable<typeof row>)).toBe('Lost 12,500')
  })

  it('names a hand that cost nothing', () => {
    const [row] = historyRows(
      [
        record({
          results: [
            { seat: 0, delta: 0, showed: false },
            { seat: 1, delta: 0, showed: false },
          ],
        }),
      ],
      'alice',
    )
    expect(outcomeLabel(row as NonNullable<typeof row>)).toBe('Broke even')
  })

  it('capitalises each street once', () => {
    expect(streetLabel('preflop')).toBe('Preflop')
    expect(streetLabel('river')).toBe('River')
  })

  it('groups thousands', () => {
    expect(formatChips(1_234_567)).toBe('1,234,567')
    expect(formatChips(0)).toBe('0')
  })
})
