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
