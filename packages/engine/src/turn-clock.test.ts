import { describe, expect, it } from 'vitest'
import { turnBudgetMs, turnClock } from './turn-clock.js'

describe('turnBudgetMs', () => {
  it('returns the named defaults for each street', () => {
    expect(turnBudgetMs('preflop')).toBe(15_000)
    expect(turnBudgetMs('flop')).toBe(20_000)
    expect(turnBudgetMs('turn')).toBe(20_000)
    expect(turnBudgetMs('river')).toBe(25_000)
  })

  it('lets a caller override a street budget', () => {
    expect(turnBudgetMs('preflop', { preflopSeconds: 30 })).toBe(30_000)
    expect(turnBudgetMs('river', { riverSeconds: 10 })).toBe(10_000)
  })

  it('falls back to defaults for unoverridden streets in a partial config', () => {
    expect(turnBudgetMs('flop', { preflopSeconds: 30 })).toBe(20_000)
  })

  it('produces a sensible value for a negative or NaN budget rather than throwing', () => {
    expect(turnBudgetMs('flop', { flopSeconds: -5 })).toBe(0)
    expect(turnBudgetMs('flop', { flopSeconds: Number.NaN })).toBe(0)
  })
})

describe('turnClock', () => {
  it('is idle with full time and the hand at rest when there is no deadline', () => {
    const clock = turnClock(null, 0, 15_000)
    expect(clock.phase).toBe('idle')
    expect(clock.remainingMs).toBe(15_000)
    expect(clock.fraction).toBe(1)
    expect(clock.handDegrees).toBe(0)
    expect(clock.urgent).toBe(false)
  })

  it('runs at the start of a turn', () => {
    const clock = turnClock(15_000, 0, 15_000)
    expect(clock.phase).toBe('running')
    expect(clock.fraction).toBeCloseTo(1, 9)
    expect(clock.handDegrees).toBeCloseTo(0, 6)
    expect(clock.urgent).toBe(false)
  })

  it('reports no negative time past the deadline', () => {
    const clock = turnClock(0, 15_000, 15_000)
    expect(clock.phase).toBe('expired')
    expect(clock.remainingMs).toBe(0)
    expect(clock.fraction).toBe(0)
  })

  it('is expired at deadline plus a full budget with exactly zero left', () => {
    const clock = turnClock(15_000, 30_000, 15_000)
    expect(clock.phase).toBe('expired')
    expect(clock.remainingMs).toBe(0)
    expect(clock.fraction).toBe(0)
  })

  it('clamps a nowMs before the turn began to the full budget', () => {
    const clock = turnClock(15_000, -10_000, 15_000)
    expect(clock.fraction).toBeCloseTo(1, 9)
    expect(clock.handDegrees).toBeCloseTo(0, 6)
    expect(clock.phase).toBe('running')
  })

  it('handles a NaN deadline as idle rather than throwing', () => {
    const clock = turnClock(Number.NaN, 0, 15_000)
    expect(clock.phase).toBe('idle')
    expect(clock.fraction).toBe(1)
    expect(clock.handDegrees).toBe(0)
  })

  it('handles a negative budget as a sensible zero-length clock', () => {
    const running = turnClock(5_000, 0, -1000)
    expect(running.phase).toBe('expired')
    expect(running.remainingMs).toBe(0)
    expect(running.fraction).toBe(0)
  })

  it('sweeps the hand monotonically, unbroken, ending at 360 at the deadline', () => {
    const budget = 15_000
    const deadline = 15_000
    let lastDegrees = -1
    for (let step = 0; step <= 20; step += 1) {
      const now = (step / 20) * budget
      const clock = turnClock(deadline, now, budget)
      expect(clock.handDegrees).toBeGreaterThanOrEqual(lastDegrees)
      lastDegrees = clock.handDegrees
    }
    const expired = turnClock(deadline, deadline + budget, budget)
    expect(expired.handDegrees).toBeCloseTo(360, 6)
  })

  it('sweeps clockwise, wired so fraction 1 is 0 degrees and fraction 0 is 360', () => {
    const early = turnClock(15_000, 0, 15_000)
    expect(early.handDegrees).toBeLessThan(90)
    const late = turnClock(15_000, 11_250, 15_000)
    expect(late.handDegrees).toBeCloseTo(270, 6)
  })

  it('flips urgent once near the midpoint and stays urgent afterwards', () => {
    const budget = 20_000
    const deadline = 20_000
    let urgentSeen = null as boolean | null
    for (let step = 0; step <= 200; step += 1) {
      const now = (step / 200) * budget * 2
      const clock = turnClock(deadline, now, budget)
      if (urgentSeen !== null && urgentSeen && !clock.urgent) {
        expect(false).toBe(true)
      }
      urgentSeen = clock.urgent
    }
    expect(urgentSeen).toBe(true)
  })

  it('uses the urgency threshold from config', () => {
    const budget = 10_000
    const deadline = 10_000
    const beforeThreshold = turnClock(deadline, 3000, budget, { urgencyFraction: 0.2 })
    expect(beforeThreshold.urgent).toBe(false)
    const afterThreshold = turnClock(deadline, 8500, budget, { urgencyFraction: 0.2 })
    expect(afterThreshold.urgent).toBe(true)
  })

  it('marks urgent phase correctly once past the threshold', () => {
    const budget = 20_000
    const deadline = 20_000
    const running = turnClock(deadline, 5000, budget)
    expect(running.phase).toBe('running')
    const urgent = turnClock(deadline, 15_000, budget)
    expect(urgent.phase).toBe('urgent')
    expect(urgent.urgent).toBe(true)
  })

  it('is deterministic for identical input', () => {
    const a = turnClock(20_000, 10_000, 20_000)
    const b = turnClock(20_000, 10_000, 20_000)
    expect(b).toEqual(a)
  })
})
