import { describe, expect, it } from 'vitest'
import type { Street } from './betting.js'
import type { Card } from './cards.js'
import type { HandRecord } from './hand-history.js'
import { buildReplay, frameAt, streetBoundaries } from './replay.js'
import type { TurnAction } from './session.js'

const ACE_SPADES: Card = { rank: 'A', suit: 's' }
const KING_HEARTS: Card = { rank: 'K', suit: 'h' }
const QUEEN_DIAMONDS: Card = { rank: 'Q', suit: 'd' }
const JACK_CLUBS: Card = { rank: 'J', suit: 'c' }
const TEN_SPADES: Card = { rank: 'T', suit: 's' }

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
    handNumber: 1,
    startedAtMs: 1_700_000_000_000,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 100_000 },
      { seat: 1, playerId: 'bob', startingStack: 100_000 },
    ],
    actions: [action(0, 'preflop', 'call'), action(1, 'preflop', 'check')],
    board: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
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

describe('buildReplay', () => {
  it('produces a first and last frame for a record with no actions', () => {
    const frames = buildReplay(record({ actions: [] }))
    expect(frames.length).toBe(2)
    expect(frames[0]?.index).toBe(0)
    expect(frames[1]?.index).toBe(1)
    expect(frames[1]?.label).toMatch(/[0-9,]+/)
  })

  it('keeps potAfter non-decreasing across frames', () => {
    const cases = [
      record({ actions: [] }),
      record(),
      multiStreetRecord('check', 'check', 'check'),
      multiStreetRecord('raiseTo', 'call', 'check', 'check'),
    ]
    for (const item of cases) {
      const frames = buildReplay(item)
      for (let i = 1; i < frames.length; i += 1) {
        const previous = frames[i - 1] as { potAfter: number }
        const current = frames[i] as { potAfter: number }
        expect(current.potAfter).toBeGreaterThanOrEqual(previous.potAfter)
      }
    }
  })

  it('ends on the settled pot', () => {
    const frames = buildReplay(record())
    expect(frames[frames.length - 1]?.potAfter).toBe(1000)
  })

  it('keeps boardAfter monotonic and never jumping by more than 3 cards at once', () => {
    const frames = buildReplay(multiStreetRecord('call', 'check', 'check', 'check', 'check'))
    let previousCount = -1
    let previousCardTotal = -1
    for (const frame of frames) {
      expect(previousCount === -1 || frame.boardAfter.length - previousCount <= 3).toBe(true)
      expect(frame.boardAfter.length).toBeGreaterThanOrEqual(previousCardTotal)
      previousCount = frame.boardAfter.length
      previousCardTotal = frame.boardAfter.length
    }
  })

  it('labels action frames with the acting seat', () => {
    const frames = buildReplay(frameRecord())
    const actingFrames = frames.filter((frame) => frame.actingSeat !== null)
    expect(actingFrames.length).toBeGreaterThan(0)
    for (const frame of actingFrames) {
      expect(frame.label).toContain(`Seat ${frame.actingSeat}`)
    }
  })

  it('labels a raise with the formatted amount', () => {
    const frames = buildReplay(
      record({
        actions: [action(0, 'preflop', 'raiseTo', 2400), action(1, 'preflop', 'fold')],
        results: [
          { seat: 0, delta: 2400, showed: false },
          { seat: 1, delta: -2400, showed: false },
        ],
      }),
    )
    const raiseFrame = frames.find((frame) => frame.label.includes('raises'))
    expect(raiseFrame?.label).toBe('Seat 0 raises to 2,400')
  })

  it('produces no post-flop frames for a hand that ends pre-flop', () => {
    const frames = buildReplay(record())
    for (const frame of frames) {
      expect(frame.street).toBe('preflop')
    }
  })

  it('builds identical replays from identical records', () => {
    const a = record()
    const b = record()
    expect(buildReplay(a)).toEqual(buildReplay(b))
  })
})

describe('frameAt', () => {
  it('clamps negative indices to the first frame', () => {
    const frames = buildReplay(record())
    expect(frameAt(frames, -5)).toEqual(frames[0])
  })

  it('clamps past-the-end indices to the last frame', () => {
    const frames = buildReplay(record())
    expect(frameAt(frames, 999)).toEqual(frames[frames.length - 1])
  })

  it('returns the frame at a valid index', () => {
    const frames = buildReplay(record())
    expect(frameAt(frames, 2)).toEqual(frames[2])
  })

  it('returns null for an empty list', () => {
    expect(frameAt([], 0)).toBeNull()
    expect(frameAt([], -3)).toBeNull()
    expect(frameAt([], 99)).toBeNull()
  })
})

describe('streetBoundaries', () => {
  it('matches the actual street changes in the record', () => {
    const frames = buildReplay(multiStreetRecord('call', 'check', 'check', 'check', 'check'))
    expect(streetBoundaries(frames)).toEqual([0, 2, 3, 4])
  })

  it('includes only streets that actually appear', () => {
    const frames = buildReplay(record())
    expect(streetBoundaries(frames)).toEqual([0])
  })
})

function frameRecord(): HandRecord {
  return record({
    actions: [action(0, 'preflop', 'call'), action(1, 'preflop', 'check')],
    results: [
      { seat: 0, delta: 500, showed: false },
      { seat: 1, delta: -500, showed: false },
    ],
  })
}

function multiStreetRecord(...kinds: TurnAction['kind'][]): HandRecord {
  const streetFor = (index: number): Street =>
    index < 1 ? 'preflop' : index < 2 ? 'flop' : index < 3 ? 'turn' : 'river'
  const actions = kinds.map((kind, index) => action(index % 2, streetFor(index), kind))
  const board: Card[] = [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES]
  let total = 0
  for (const entry of actions) {
    if (entry.action.kind === 'raiseTo') total += entry.action.to
  }
  const winner = actions[0]?.seat ?? 0
  const loser = actions[1]?.seat ?? 1
  return record({
    actions,
    board,
    results: [
      { seat: winner, delta: total, showed: false },
      { seat: loser, delta: -total, showed: false },
    ],
  })
}
