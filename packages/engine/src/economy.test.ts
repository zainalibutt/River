import { describe, expect, it } from 'vitest'
import type { EconomyConfig, EconomyState, GrantDecision } from './economy.js'
import { claimDaily, claimRescue, utcDay } from './economy.js'

const DAY_MS = 86_400_000
const BASE_DAY = Date.UTC(2026, 7, 24)

const CONFIG: EconomyConfig = {
  signupBankroll: 150_000,
  rescueFloor: 50_000,
  rescueThreshold: 1_000,
  rescueDailyCap: 3,
  dailyBase: 10_000,
  dailyStreakBonus: [0, 5_000, 10_000, 20_000, 30_000, 45_000, 90_000],
}

const ELIGIBLE_CONFIG: EconomyConfig = {
  ...CONFIG,
  rescueThreshold: 30_000,
}

function dayN(n: number): number {
  return BASE_DAY + (n - 1) * DAY_MS
}

function state(overrides: Partial<EconomyState> = {}): EconomyState {
  return {
    playerId: 'p-1',
    balance: 0,
    seated: false,
    lastDailyClaimDay: null,
    streakDay: 0,
    rescuesToday: 0,
    rescueDay: null,
    ...overrides,
  }
}

function mustGrant(decision: GrantDecision | null): GrantDecision {
  if (decision === null) {
    throw new Error('expected a grant decision')
  }
  return decision
}

describe('utcDay', () => {
  it('formats a UTC day deterministically', () => {
    expect(utcDay(BASE_DAY)).toBe('2026-08-24')
    expect(utcDay(BASE_DAY - 1)).toBe('2026-08-23')
  })
})

describe('claimDaily', () => {
  it('pays base plus first-day bonus on a fresh streak', () => {
    const decision = mustGrant(claimDaily(state(), CONFIG, dayN(1)))
    expect(decision.delta).toBe(10_000)
    expect(decision.kind).toBe('daily')
    expect(decision.reason).toBe('daily_login')
    expect(decision.nextState.streakDay).toBe(1)
    expect(decision.nextState.lastDailyClaimDay).toBe('2026-08-24')
  })

  it('returns null on a second claim the same UTC day', () => {
    const first = mustGrant(claimDaily(state(), CONFIG, dayN(1)))
    expect(claimDaily(first.nextState, CONFIG, dayN(1))).toBeNull()
  })

  it('pays the full 1..7 curve with day 7 largest', () => {
    let current = state()
    const deltas: number[] = []
    for (let day = 1; day <= 7; day += 1) {
      const decision = mustGrant(claimDaily(current, CONFIG, dayN(day)))
      expect(decision.nextState.lastDailyClaimDay).toBe(utcDay(dayN(day)))
      expect(decision.nextState.streakDay).toBe(day)
      deltas.push(decision.delta)
      current = decision.nextState
    }
    expect(deltas).toEqual([10_000, 15_000, 20_000, 30_000, 40_000, 55_000, 100_000])
    expect(deltas[6]).toBe(100_000)
    expect(deltas[6]).toBe(Math.max(...deltas))
  })

  it('resets the streak to 1 after a missed day', () => {
    const first = mustGrant(claimDaily(state(), CONFIG, dayN(1)))
    const decision = mustGrant(claimDaily(first.nextState, CONFIG, dayN(3)))
    expect(decision.delta).toBe(10_000)
    expect(decision.nextState.streakDay).toBe(1)
  })

  it('cycles back to streak day 1 after day 7', () => {
    let current = state()
    for (let day = 1; day <= 7; day += 1) {
      current = mustGrant(claimDaily(current, CONFIG, dayN(day))).nextState
    }
    expect(current.streakDay).toBe(7)
    const day8 = mustGrant(claimDaily(current, CONFIG, dayN(8)))
    expect(day8.delta).toBe(10_000)
    expect(day8.nextState.streakDay).toBe(1)
  })

  it('resumes a mid-streak after consecutive days', () => {
    const seeded = state({ lastDailyClaimDay: '2026-08-25', streakDay: 2 })
    const decision = mustGrant(claimDaily(seeded, CONFIG, dayN(3)))
    expect(decision.delta).toBe(20_000)
    expect(decision.nextState.streakDay).toBe(3)
  })

  it('emits a deterministic per-day ref', () => {
    const first = mustGrant(claimDaily(state(), CONFIG, dayN(1)))
    expect(first.ref).toBe('daily:p-1:2026-08-24')
    const second = mustGrant(claimDaily(state(), CONFIG, dayN(2)))
    expect(second.ref).toBe('daily:p-1:2026-08-25')
    const again = mustGrant(claimDaily(state(), CONFIG, dayN(1)))
    expect(again.ref).toBe(first.ref)
  })
})

describe('claimRescue', () => {
  it('tops balance 0 up to one legal minimum buy-in', () => {
    const decision = mustGrant(claimRescue(state(), ELIGIBLE_CONFIG, dayN(1)))
    expect(decision.delta).toBe(50_000)
    expect(decision.nextState.balance).toBe(50_000)
  })

  it('tops a partial balance to the floor rather than adding the full floor', () => {
    const decision = mustGrant(claimRescue(state({ balance: 24_000 }), ELIGIBLE_CONFIG, dayN(1)))
    expect(decision.delta).toBe(26_000)
    expect(decision.delta).not.toBe(50_000)
    expect(decision.nextState.balance).toBe(50_000)
  })

  it('returns null while seated', () => {
    expect(claimRescue(state({ seated: true }), CONFIG, dayN(1))).toBeNull()
  })

  it('returns null when balance is at or above the threshold', () => {
    expect(claimRescue(state({ balance: 1_000 }), CONFIG, dayN(1))).toBeNull()
    expect(claimRescue(state({ balance: 2_000 }), CONFIG, dayN(1))).toBeNull()
  })

  it('returns null once the daily cap is reached', () => {
    const capped = state({ rescuesToday: 3, rescueDay: '2026-08-24' })
    expect(claimRescue(capped, CONFIG, dayN(1))).toBeNull()
  })

  it('returns null on the cap-plus-first extra rescue in a day', () => {
    let current = state()
    for (let i = 0; i < CONFIG.rescueDailyCap; i += 1) {
      const granted = mustGrant(claimRescue(current, CONFIG, dayN(1)))
      current = { ...granted.nextState, balance: 0 }
    }
    expect(current.rescuesToday).toBe(CONFIG.rescueDailyCap)
    expect(claimRescue({ ...current, balance: 0 }, CONFIG, dayN(1))).toBeNull()
  })

  it('resets the daily counter on a new UTC day', () => {
    const exhausted = state({ rescuesToday: 3, rescueDay: '2026-08-24' })
    const decision = mustGrant(claimRescue(exhausted, CONFIG, dayN(2)))
    expect(decision.delta).toBe(50_000)
    expect(decision.nextState.rescueDay).toBe('2026-08-25')
    expect(decision.nextState.rescuesToday).toBe(1)
  })

  it('emits a unique per-day per-claim ref', () => {
    const first = mustGrant(claimRescue(state(), CONFIG, dayN(1)))
    expect(first.ref).toBe('rescue:p-1:2026-08-24:1')
    const second = mustGrant(claimRescue(state(), CONFIG, dayN(1)))
    expect(second.ref).toBe('rescue:p-1:2026-08-24:1')
    const freshDay = mustGrant(claimRescue(state(), CONFIG, dayN(2)))
    expect(freshDay.ref).toBe('rescue:p-1:2026-08-25:1')
  })
})
