import { buildReplay, type Card, type HandRecord } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  handsPlayed,
  historyRows,
  netChips,
  outcomeLabel,
  replayStepLabel,
  type SessionHand,
  sessionRows,
  showdownPercent,
  streetLabel,
  withSettledHands,
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

describe('a session across tables', () => {
  // Each table counts its hands from one, so two tables in a session both deal a hand #1.
  const tableOne = [
    record({ handNumber: 1, commit: 'table-one-1' }),
    record({ handNumber: 2, commit: 'table-one-2' }),
  ]
  const tableTwo = [
    record({ handNumber: 1, commit: 'table-two-1' }),
    record({ handNumber: 2, commit: 'table-two-2' }),
    record({ handNumber: 3, commit: 'table-two-3' }),
  ]

  it('labels every hand apart and lists the newest first', () => {
    let hands: readonly SessionHand[] = []
    // One message per settled hand, as the room sends them.
    for (const settled of [...tableOne, ...tableTwo]) hands = withSettledHands(hands, [settled])
    const rows = sessionRows(hands, 'alice')
    const labels = rows.map((row) => row.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual(['#5', '#4', '#3', '#2', '#1'])
    expect(rows.map((row) => row.record.commit)).toEqual([
      'table-two-3',
      'table-two-2',
      'table-two-1',
      'table-one-2',
      'table-one-1',
    ])
  })

  it('puts the last hand of a batch first', () => {
    const rows = sessionRows(withSettledHands([], tableOne), 'alice')
    expect(rows.map((row) => [row.label, row.record.commit])).toEqual([
      ['#2', 'table-one-2'],
      ['#1', 'table-one-1'],
    ])
  })

  it('never gives a number twice once the oldest hands drop off', () => {
    let hands: readonly SessionHand[] = []
    for (const settled of [...tableOne, ...tableTwo]) hands = withSettledHands(hands, [settled], 3)
    expect(hands.map((hand) => hand.sessionNumber)).toEqual([5, 4, 3])
    hands = withSettledHands(hands, [record({ handNumber: 1, commit: 'table-three-1' })], 3)
    expect(hands.map((hand) => hand.sessionNumber)).toEqual([6, 5, 4])
  })

  it('tells each row from the asking player side, whichever table dealt it', () => {
    const rows = sessionRows(withSettledHands([], [...tableOne, ...tableTwo]), 'bob')
    expect(rows.every((row) => row.outcome === 'lost' && row.deltaChips === -500)).toBe(true)
    expect(netChips(rows)).toBe(-2_500)
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
    const [row] = historyRows(
      [
        record({
          results: [
            { seat: 0, delta: 1_234_567, showed: true },
            { seat: 1, delta: -1_234_567, showed: true },
          ],
        }),
      ],
      'alice',
    )
    expect(outcomeLabel(row as NonNullable<typeof row>)).toBe('Won 1,234,567')
  })
})

describe('in big blinds', () => {
  // The table's stake, 250/500.
  const bigBlind = 500
  const raised = record({
    actions: [
      { seat: 0, street: 'preflop', action: { kind: 'raiseTo', to: 1_500 } },
      { seat: 1, street: 'preflop', action: { kind: 'call' } },
      { seat: 1, street: 'flop', action: { kind: 'check' } },
    ],
    potSize: 3_000,
    results: [
      { seat: 0, delta: 1_843, showed: true },
      { seat: 1, delta: -1_843, showed: true },
    ],
  })

  it('names a result in the table big blinds', () => {
    const [won] = historyRows([raised], 'alice')
    const [lost] = historyRows([raised], 'bob')
    expect(outcomeLabel(won as NonNullable<typeof won>, bigBlind)).toBe('Won 3.7 BB')
    expect(outcomeLabel(lost as NonNullable<typeof lost>, bigBlind)).toBe('Lost 3.7 BB')
    expect(outcomeLabel(won as NonNullable<typeof won>)).toBe('Won 1,843')
  })

  it('words every replay step as the engine does while amounts are in chips', () => {
    const frames = buildReplay(raised)
    expect(frames.map((frame) => replayStepLabel(raised, frame, null))).toEqual(
      frames.map((frame) => frame.label),
    )
  })

  it('writes the raise and the settled pot of a replay in big blinds', () => {
    const frames = buildReplay(raised)
    expect(frames.map((frame) => replayStepLabel(raised, frame, bigBlind))).toEqual([
      'Deal',
      'Seat 0 raises to 3 BB',
      'Seat 1 calls',
      'Seat 1 checks',
      'Pot settled at 6 BB',
    ])
  })
})
