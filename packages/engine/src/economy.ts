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

/**
 * The daily wheel (9 Nov 2026): one free spin a UTC day, five equal segments,
 * replacing the flat base-plus-streak gift. Averages 30,000 a day, about what the
 * old seven-day streak paid in a week. Odds are equal and shown to the player.
 */
export const DAILY_WHEEL_PRIZES: readonly number[] = [10_000, 20_000, 30_000, 40_000, 50_000]

/**
 * The segment a day's spin lands on, from a digest the server alone can make: an HMAC of
 * the player and the day under a server secret. The same player and day always land on
 * the same segment, so a retried claim, or one made at the table and the menu at once,
 * pays one prize and both say the same. Without the secret it cannot be predicted.
 */
export function wheelSegment(digest: Uint8Array): number {
  if (digest.length < 4) throw new Error('wheel digest too short')
  const value =
    ((digest[0] ?? 0) * 0x1000000 +
      ((digest[1] ?? 0) << 16) +
      ((digest[2] ?? 0) << 8) +
      (digest[3] ?? 0)) >>>
    0
  return value % DAILY_WHEEL_PRIZES.length
}

/** HMAC-SHA256 of the player and day, by Web Crypto so the server and the menu route agree. */
export async function dailyWheelSegment(
  secret: string,
  playerId: string,
  day: string,
): Promise<number> {
  const encoder = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(`river-daily-wheel-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${playerId}:${day}`),
  )
  return wheelSegment(new Uint8Array(signature))
}

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
  /** The wheel's prize for today; when given it is the whole grant, streak or not. */
  wheelPrize?: number,
): GrantDecision | null {
  const today = utcDay(nowMs)
  if (state.lastDailyClaimDay === today) {
    return null
  }
  const consecutive =
    state.lastDailyClaimDay !== null && state.lastDailyClaimDay === previousUtcDay(nowMs)
  const streakDay = consecutive ? (state.streakDay % config.dailyStreakBonus.length) + 1 : 1
  const bonus = config.dailyStreakBonus[streakDay - 1] ?? 0
  const delta = wheelPrize ?? config.dailyBase + bonus
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
    /** The least a spin now pays; what it lands on is decided at the claim. */
    amount: number
    /** The streak day a claim now would reach, or the current one when claimed today. */
    streakDay: number
    /** When the next claim opens: now when one is waiting, else the next UTC midnight. */
    nextAtMs: number
    /** The wheel's segments, in order, each equally likely. */
    prizes: readonly number[]
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
  // Claimable is "not spun today": asked with a wheel prize, so a flat base set to
  // nothing cannot hide the wheel. What it lands on is the server's, at the claim.
  const daily = claimDaily(state, config, nowMs, DAILY_WHEEL_PRIZES[0])
  const rescue = claimRescue(state, config, nowMs)
  const rescuesToday = state.rescueDay === utcDay(nowMs) ? state.rescuesToday : 0
  return {
    daily: {
      claimable: daily !== null,
      amount: daily?.delta ?? 0,
      streakDay: daily?.nextState.streakDay ?? state.streakDay,
      nextAtMs: daily !== null ? nowMs : (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS,
      prizes: DAILY_WHEEL_PRIZES,
    },
    rescue: {
      claimable: rescue !== null,
      amount: rescue?.delta ?? 0,
      left: Math.max(0, config.rescueDailyCap - rescuesToday),
    },
  }
}
