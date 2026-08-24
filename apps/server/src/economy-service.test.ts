import type { EconomyConfig } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { EconomyDeps, GrantOutcome, LedgerRow } from './economy-service.js'
import { claimDailyFor, claimRescueFor, deriveEconomyState } from './economy-service.js'
import type { LedgerEntry } from './ledger.js'

const DAY_MS = 86_400_000
const BASE_DAY = Date.UTC(2026, 7, 24)
const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'

const CONFIG: EconomyConfig = {
  signupBankroll: 100_000,
  rescueFloor: 25_000,
  rescueThreshold: 1_000,
  rescueDailyCap: 3,
  dailyBase: 10_000,
  dailyStreakBonus: [0, 5_000, 10_000, 20_000, 30_000, 45_000, 90_000],
}

function dayOf(n: number): string {
  return new Date(BASE_DAY + (n - 1) * DAY_MS).toISOString().slice(0, 10)
}

function dailyRef(n: number): string {
  return `daily:${PLAYER_ID}:${dayOf(n)}`
}

function rescueRef(n: number, claim: number): string {
  return `rescue:${PLAYER_ID}:${dayOf(n)}:${claim}`
}

function row(ref: string, reason: string, delta: number): LedgerRow {
  return { ref, reason, delta }
}

class MemoryDeps implements EconomyDeps {
  rows: LedgerRow[] = []
  seatedNow = false
  config: EconomyConfig = CONFIG
  balance = 0

  async readRows(): Promise<LedgerRow[]> {
    return this.rows
  }

  async readConfig(): Promise<EconomyConfig> {
    return this.config
  }

  async apply(entry: LedgerEntry): Promise<number> {
    if (this.rows.some((item) => item.ref === entry.ref)) {
      return this.balance
    }
    this.balance += entry.delta
    this.rows.push({ ref: entry.ref, reason: entry.reason, delta: entry.delta })
    return this.balance
  }

  async seated(): Promise<boolean> {
    return this.seatedNow
  }
}

describe('deriveEconomyState', () => {
  it('derives nothing from an empty ledger', () => {
    const state = deriveEconomyState([], false, BASE_DAY)
    expect(state.playerId).toBe('')
    expect(state.balance).toBe(0)
    expect(state.lastDailyClaimDay).toBeNull()
    expect(state.streakDay).toBe(0)
    expect(state.rescuesToday).toBe(0)
    expect(state.rescueDay).toBeNull()
  })

  it('derives a running streak from consecutive daily refs', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(dailyRef(n), 'daily_login', 10_000))
    const state = deriveEconomyState(rows, false, BASE_DAY)
    expect(state.lastDailyClaimDay).toBe(dayOf(7))
    expect(state.streakDay).toBe(7)
  })

  it('caps the streak count at seven', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(dailyRef(n), 'daily_login', 10_000))
    const state = deriveEconomyState(rows, false, BASE_DAY)
    expect(state.streakDay).toBe(7)
  })

  it('drops the streak at the first gap walking backwards', () => {
    const rows = [row(dailyRef(1), 'daily_login', 10_000), row(dailyRef(3), 'daily_login', 10_000)]
    const state = deriveEconomyState(rows, false, BASE_DAY)
    expect(state.lastDailyClaimDay).toBe(dayOf(3))
    expect(state.streakDay).toBe(1)
  })

  it('counts only today rescue refs and records the rescue day', () => {
    const rows = [
      row(rescueRef(1, 1), 'bust_rescue', 25_000),
      row(rescueRef(1, 2), 'bust_rescue', 0),
    ]
    const state = deriveEconomyState(rows, false, BASE_DAY)
    expect(state.rescuesToday).toBe(2)
    expect(state.rescueDay).toBe(dayOf(1))
  })

  it('drops the rescue counter on a new UTC day', () => {
    const rows = [row(rescueRef(1, 1), 'bust_rescue', 25_000)]
    const state = deriveEconomyState(rows, false, BASE_DAY + DAY_MS)
    expect(state.rescuesToday).toBe(0)
    expect(state.rescueDay).toBeNull()
  })

  it('reflects the seated flag from live room state', () => {
    const state = deriveEconomyState([], true, BASE_DAY)
    expect(state.seated).toBe(true)
  })
})

describe('claimDailyFor', () => {
  it('grants the first-of-day claim and writes one ledger row', async () => {
    const deps = new MemoryDeps()
    const outcome = await claimDailyFor(PLAYER_ID, deps, BASE_DAY)
    expect(outcome).toEqual({
      kind: 'granted',
      delta: 10_000,
      balance: 10_000,
      ref: dailyRef(1),
    })
    expect(deps.rows).toHaveLength(1)
  })

  it('returns already-claimed on a second claim the same UTC day', async () => {
    const deps = new MemoryDeps()
    const first = (await claimDailyFor(PLAYER_ID, deps, BASE_DAY)) as GrantOutcome & {
      kind: 'granted'
    }
    expect(first).toMatchObject({ kind: 'granted' })
    const second = await claimDailyFor(PLAYER_ID, deps, BASE_DAY)
    expect(second).toEqual({ kind: 'ineligible', reason: 'already-claimed' })
    expect(deps.rows).toHaveLength(1)
  })

  it('pays the full seven day curve and cycles back to day one', async () => {
    const deps = new MemoryDeps()
    const deltas: number[] = []
    for (let day = 1; day <= 7; day += 1) {
      const outcome = await claimDailyFor(PLAYER_ID, deps, BASE_DAY + (day - 1) * DAY_MS)
      expect(outcome).toMatchObject({ kind: 'granted' })
      if (outcome.kind === 'granted') deltas.push(outcome.delta)
    }
    expect(deltas).toEqual([10_000, 15_000, 20_000, 30_000, 40_000, 55_000, 100_000])
    const eighth = await claimDailyFor(PLAYER_ID, deps, BASE_DAY + 7 * DAY_MS)
    expect(eighth).toMatchObject({ kind: 'granted', delta: 10_000 })
  })

  it('resets the streak to one after a missed day', async () => {
    const deps = new MemoryDeps()
    await claimDailyFor(PLAYER_ID, deps, BASE_DAY)
    await claimDailyFor(PLAYER_ID, deps, BASE_DAY + DAY_MS)
    const afterGap = await claimDailyFor(PLAYER_ID, deps, BASE_DAY + 3 * DAY_MS)
    expect(afterGap).toMatchObject({ kind: 'granted', delta: 10_000 })
  })
})

describe('claimRescueFor', () => {
  it('tops a zero balance up to the floor exactly', async () => {
    const deps = new MemoryDeps()
    const outcome = await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
    expect(outcome).toEqual({
      kind: 'granted',
      delta: 25_000,
      balance: 25_000,
      ref: rescueRef(1, 1),
    })
  })

  it('refuses rescue while seated and writes nothing', async () => {
    const deps = new MemoryDeps()
    deps.seatedNow = true
    const outcome = await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
    expect(outcome).toEqual({ kind: 'ineligible', reason: 'not-eligible' })
    expect(deps.rows).toHaveLength(0)
  })

  it('returns capped on the claim after the daily cap', async () => {
    const deps = new MemoryDeps()
    for (let claim = 1; claim <= 3; claim += 1) {
      const outcome = await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
      expect(outcome).toMatchObject({ kind: 'granted' })
      const current = deps.rows.reduce((sum, item) => sum + item.delta, 0)
      deps.rows.push(row(`table:${claim}`, 'table_cash_out', -current))
    }
    const extra = await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
    expect(extra).toEqual({ kind: 'ineligible', reason: 'capped' })
  })

  it('writes no second row when the same claim is replayed', async () => {
    const deps = new MemoryDeps()
    await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
    const replay = await claimRescueFor(PLAYER_ID, deps, BASE_DAY)
    expect(replay.kind).toBe('ineligible')
    expect(deps.rows).toHaveLength(1)
  })
})
