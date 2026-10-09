export interface EconomyConfig {
  signupBankroll: number
  rescueFloor: number
  rescueThreshold: number
  rescueDailyCap: number
  dailyBase: number
  dailyStreakBonus: number[]
}

export interface EconomyState {
  playerId: string
  balance: number
  seated: boolean
  lastDailyClaimDay: string | null
  streakDay: number
  rescuesToday: number
  rescueDay: string | null
}

export interface GrantDecision {
  kind: 'daily' | 'rescue'
  delta: number
  reason: string
  ref: string
  nextState: EconomyState
}

const DAY_MS = 86_400_000

export function utcDay(nowMs: number): string {
  const date = new Date(nowMs)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function previousUtcDay(nowMs: number): string {
  return utcDay(nowMs - DAY_MS)
}

export function claimDaily(
  state: EconomyState,
  config: EconomyConfig,
  nowMs: number,
): GrantDecision | null {
  const today = utcDay(nowMs)
  if (state.lastDailyClaimDay === today) {
    return null
  }
  const consecutive =
    state.lastDailyClaimDay !== null && state.lastDailyClaimDay === previousUtcDay(nowMs)
  const streakDay = consecutive ? (state.streakDay % config.dailyStreakBonus.length) + 1 : 1
  const bonus = config.dailyStreakBonus[streakDay - 1] ?? 0
  const delta = config.dailyBase + bonus
  if (delta <= 0) {
    return null
  }
  return {
    kind: 'daily',
    delta,
    reason: 'daily_login',
    ref: `daily:${state.playerId}:${today}`,
    nextState: {
      ...state,
      balance: state.balance + delta,
      lastDailyClaimDay: today,
      streakDay,
    },
  }
}

export function claimRescue(
  state: EconomyState,
  config: EconomyConfig,
  nowMs: number,
): GrantDecision | null {
  const today = utcDay(nowMs)
  if (state.seated) {
    return null
  }
  if (state.balance >= config.rescueThreshold) {
    return null
  }
  const rescuesToday = state.rescueDay === today ? state.rescuesToday : 0
  if (rescuesToday >= config.rescueDailyCap) {
    return null
  }
  const delta = config.rescueFloor - state.balance
  if (delta <= 0) {
    return null
  }
  return {
    kind: 'rescue',
    delta,
    reason: 'bust_rescue',
    ref: `rescue:${state.playerId}:${today}:${rescuesToday + 1}`,
    nextState: {
      ...state,
      balance: state.balance + delta,
      rescuesToday: rescuesToday + 1,
      rescueDay: today,
    },
  }
}

/** One row of a player's chip ledger, as far as the economy reads it. */
export interface LedgerRow {
  ref: string
  reason: string
  delta: number
}

const PREFIX_DAILY = 'daily:'
const PREFIX_RESCUE = 'rescue:'

function dayOfRef(ref: string, prefix: string): string | null {
  if (!ref.startsWith(prefix)) return null
  return ref.slice(prefix.length).split(':')[1] ?? null
}

function refPlayerId(ref: string, prefix: string): string | null {
  if (!ref.startsWith(prefix)) return null
  return ref.slice(prefix.length).split(':')[0] ?? null
}

function dayBefore(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (match === null) return null
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() - 1)
  return utcDay(date.getTime())
}

/** A player's economy as their ledger records it: balance, daily streak and rescues today. */
export function deriveEconomyState(
  ledgerRows: readonly LedgerRow[],
  seated: boolean,
  nowMs: number,
): EconomyState {
  const today = utcDay(nowMs)
  let playerId = ''
  let balance = 0
  const dailyDays = new Set<string>()
  let rescuesToday = 0
  for (const entry of ledgerRows) {
    balance += entry.delta
    const dailyDay = dayOfRef(entry.ref, PREFIX_DAILY)
    if (dailyDay !== null) {
      playerId = refPlayerId(entry.ref, PREFIX_DAILY) ?? playerId
      dailyDays.add(dailyDay)
      continue
    }
    const rescueDay = dayOfRef(entry.ref, PREFIX_RESCUE)
    if (rescueDay === null) continue
    playerId = refPlayerId(entry.ref, PREFIX_RESCUE) ?? playerId
    if (rescueDay === today) rescuesToday += 1
  }
  const lastDailyClaimDay = maxOf(dailyDays)
  let streakDay = 0
  if (lastDailyClaimDay !== null) {
    let cursor = lastDailyClaimDay
    while (streakDay < 7 && dailyDays.has(cursor)) {
      streakDay += 1
      const previous = dayBefore(cursor)
      if (previous === null) break
      cursor = previous
    }
  }
  return {
    playerId,
    balance,
    seated,
    lastDailyClaimDay,
    streakDay,
    rescuesToday,
    rescueDay: rescuesToday > 0 ? today : null,
  }
}

function maxOf(days: ReadonlySet<string>): string | null {
  let max: string | null = null
  for (const day of days) {
    if (max === null || day > max) max = day
  }
  return max
}

/** What a player can claim now, and when the next daily claim opens. */
export interface EconomyStatus {
  daily: {
    claimable: boolean
    /** What a claim now would grant, base and streak bonus together. */
    amount: number
    /** The streak day a claim now would reach, or the current one when claimed today. */
    streakDay: number
    /** When the next claim opens: now when one is waiting, else the next UTC midnight. */
    nextAtMs: number
  }
  rescue: { claimable: boolean; amount: number; left: number }
}

/**
 * The claims a player could make, worked out by the same rules that grant them, so a
 * menu never offers chips the server would refuse.
 */
export function economyStatus(
  state: EconomyState,
  config: EconomyConfig,
  nowMs: number,
): EconomyStatus {
  const daily = claimDaily(state, config, nowMs)
  const rescue = claimRescue(state, config, nowMs)
  const rescuesToday = state.rescueDay === utcDay(nowMs) ? state.rescuesToday : 0
  return {
    daily: {
      claimable: daily !== null,
      amount: daily?.delta ?? 0,
      streakDay: daily?.nextState.streakDay ?? state.streakDay,
      nextAtMs: daily !== null ? nowMs : (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS,
    },
    rescue: {
      claimable: rescue !== null,
      amount: rescue?.delta ?? 0,
      left: Math.max(0, config.rescueDailyCap - rescuesToday),
    },
  }
}
