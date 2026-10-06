import { describe, expect, it } from 'vitest'
import type { Street } from './betting.js'
import type { HandRecord } from './hand-history.js'
import type { TurnAction } from './session.js'
import type { ShowdownBeat } from './showdown-reel.js'
import { showdownReel } from './showdown-reel.js'

function action(
  seat: number,
  street: Street,
  kind: TurnAction['kind'],
  to?: number,
): { seat: number; street: Street; action: TurnAction } {
  const value: TurnAction = kind === 'raiseTo' ? { kind: 'raiseTo', to: to ?? 0 } : { kind }
  return { seat, street, action: value }
}

function record(overrides: Partial<HandRecord>): HandRecord {
  return {
    handNumber: 4,
    startedAtMs: 0,
    stake: { smallBlind: 250, bigBlind: 500 },
    seats: [
      { seat: 0, playerId: 'alice', startingStack: 10_000 },
      { seat: 1, playerId: 'bob', startingStack: 10_000 },
      { seat: 2, playerId: 'cara', startingStack: 10_000 },
    ],
    actions: [action(0, 'preflop', 'call'), action(1, 'preflop', 'call')],
    board: [],
    potSize: 3000,
    results: [
      { seat: 0, delta: 3000, showed: true },
      { seat: 1, delta: 0, showed: true },
      { seat: 2, delta: -3000, showed: true },
    ],
    commit: 'c',
    revealedSeed: null,
    ...overrides,
  }
}

describe('showdownReel', () => {
  it('produces a coherent reel for a multi-way showdown', () => {
    const reel = showdownReel({ record: record({}) })
    expect(reel.beats.length).toBeGreaterThan(0)
    const last = reel.beats[reel.beats.length - 1] as ShowdownBeat
    expect(reel.totalMs).toBe(last.atMs + last.holdMs)
  })

  it('schedules beats strictly forward with never-overlapping start times', () => {
    const reel = showdownReel({ record: record({}) })
    for (let i = 1; i < reel.beats.length; i += 1) {
      const prev = reel.beats[i - 1] as ShowdownBeat
      const current = reel.beats[i] as ShowdownBeat
      expect(current.atMs).toBeGreaterThanOrEqual(prev.atMs + prev.holdMs)
    }
    expect((reel.beats[0] as ShowdownBeat).atMs).toBe(0)
  })

  it('drops the name beat but keeps reveal and award when the hand name is absent', () => {
    const onlyHidden: HandRecord = record({
      results: [
        { seat: 0, delta: 3000, showed: true },
        { seat: 1, delta: 3000, showed: true },
        { seat: 2, delta: -3000, showed: true },
      ],
    })
    const reel = showdownReel({ record: onlyHidden })
    const reveals = reel.beats.filter((beat) => beat.kind === 'reveal')
    const awards = reel.beats.filter((beat) => beat.kind === 'award')
    const names = reel.beats.filter((beat) => beat.kind === 'name')
    expect(reveals.length).toBeGreaterThan(0)
    expect(awards.length).toBeGreaterThan(0)
    expect(names.length).toBe(0)
  })

  it('produces exactly one award beat for an uncontested pot, no reveals', () => {
    const uncontested: HandRecord = record({
      results: [
        { seat: 0, delta: 3000, showed: false },
        { seat: 2, delta: -3000, showed: false },
      ],
    })
    const reel = showdownReel({ record: uncontested })
    expect(reel.beats).toHaveLength(1)
    expect((reel.beats[0] as ShowdownBeat).kind).toBe('award')
  })

  it('handles a split pot without throwing', () => {
    const split: HandRecord = record({
      results: [
        { seat: 0, delta: 1500, showed: true },
        { seat: 1, delta: 1500, showed: true },
        { seat: 2, delta: -3000, showed: true },
      ],
    })
    const reel = showdownReel({ record: split })
    const awards = reel.beats.filter((beat) => beat.kind === 'award')
    expect(awards.length).toBe(2)
  })

  it('is pure and deterministic for identical input', () => {
    const a = showdownReel({ record: record({}) })
    const b = showdownReel({ record: record({}) })
    expect(b).toEqual(a)
  })

  it('lets durations be configured through options', () => {
    const reel = showdownReel(
      { record: record({ results: [{ seat: 0, delta: 3000, showed: true }] }) },
      { revealHoldMs: 100, awardHoldMs: 200 },
    )
    const reveal = reel.beats.find((beat) => beat.kind === 'reveal') as ShowdownBeat | undefined
    const award = reel.beats.find((beat) => beat.kind === 'award') as ShowdownBeat | undefined
    expect(reveal?.holdMs).toBe(100)
    expect(award?.holdMs).toBe(200)
  })
})
