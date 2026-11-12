import type { EconomyConfig, EconomyState } from '@river/engine'
import {
  claimDaily,
  claimRescue,
  DAILY_WHEEL_PRIZES,
  dailyWheelSegment,
  deriveEconomyState,
  type LedgerRow,
  utcDay,
} from '@river/engine'
import type { Ledger, LedgerEntry } from './ledger.js'

export type GrantOutcome =
  | { kind: 'granted'; delta: number; balance: number; ref: string }
  | { kind: 'ineligible'; reason: 'already-claimed' | 'not-eligible' | 'capped' }

export type { LedgerRow }
export { deriveEconomyState }

export interface EconomyDeps {
  readRows(playerId: string): Promise<LedgerRow[]>
  readConfig(): Promise<EconomyConfig>
  apply(entry: LedgerEntry): Promise<number>
  seated(playerId: string): Promise<boolean>
  /** The server secret the daily wheel is keyed by; without it the flat daily gift pays. */
  wheelSecret?: string
}

export interface EconomyRestClient {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}

export interface SupabaseEconomyOptions extends EconomyRestClient {
  ledger: Ledger
}

export type SupabaseEconomy = Omit<EconomyDeps, 'seated'>

const CONFIG_TTL_MS = 60_000
const configCache = new Map<string, { value: EconomyConfig; loadedAt: number }>()

export async function claimDailyFor(
  playerId: string,
  deps: EconomyDeps,
  nowMs: number,
): Promise<GrantOutcome> {
  const config = await deps.readConfig()
  const rows = await deps.readRows(playerId)
  const state = { ...deriveEconomyState(rows, await deps.seated(playerId), nowMs), playerId }
  const prize =
    deps.wheelSecret === undefined
      ? undefined
      : DAILY_WHEEL_PRIZES[await dailyWheelSegment(deps.wheelSecret, playerId, utcDay(nowMs))]
  const decision = claimDaily(state, config, nowMs, prize)
  if (decision === null) {
    return { kind: 'ineligible', reason: 'already-claimed' }
  }
  const balance = await deps.apply({
    playerId,
    delta: decision.delta,
    reason: decision.reason,
    ref: decision.ref,
  })
  return { kind: 'granted', delta: decision.delta, balance, ref: decision.ref }
}

export async function claimRescueFor(
  playerId: string,
  deps: EconomyDeps,
  nowMs: number,
): Promise<GrantOutcome> {
  const config = await deps.readConfig()
  if (await deps.seated(playerId)) {
    return { kind: 'ineligible', reason: 'not-eligible' }
  }
  const rows = await deps.readRows(playerId)
  const state = { ...deriveEconomyState(rows, false, nowMs), playerId }
  const decision = claimRescue(state, config, nowMs)
  if (decision === null) {
    const today = utcDay(nowMs)
    const rescuesToday = state.rescueDay === today ? state.rescuesToday : 0
    return rescuesToday >= config.rescueDailyCap
      ? { kind: 'ineligible', reason: 'capped' }
      : { kind: 'ineligible', reason: 'not-eligible' }
  }
  const balance = await deps.apply({
    playerId,
    delta: decision.delta,
    reason: decision.reason,
    ref: decision.ref,
  })
  return { kind: 'granted', delta: decision.delta, balance, ref: decision.ref }
}

/** Ledger rows read at a time, under the rows Supabase returns for one request. */
const LEDGER_PAGE = 500

export function createSupabaseEconomy(options: SupabaseEconomyOptions): SupabaseEconomy {
  const baseUrl = options.supabaseUrl.replace(/\/$/, '')
  const request = options.fetch ?? fetch
  const headers = (): Record<string, string> => ({
    apikey: options.serviceRoleKey,
    authorization: `Bearer ${options.serviceRoleKey}`,
    'content-type': 'application/json',
  })
  return {
    // Read a page at a time: Supabase returns at most a fixed number of rows to
    // one request, and a long-standing player's history is longer than that.
    // Read whole, it was cut short, and the balance and the daily streak worked
    // out from it were wrong.
    async readRows(playerId: string): Promise<LedgerRow[]> {
      const rows: LedgerRow[] = []
      for (let offset = 0; ; offset += LEDGER_PAGE) {
        const query = new URL(`${baseUrl}/rest/v1/chip_ledger`)
        query.searchParams.set('player_id', `eq.${playerId}`)
        query.searchParams.set('select', 'ref,reason,delta')
        query.searchParams.set('order', 'id.asc')
        query.searchParams.set('limit', String(LEDGER_PAGE))
        query.searchParams.set('offset', String(offset))
        const body = await readJson(request, query, headers())
        if (!Array.isArray(body)) {
          throw new Error('Supabase returned an invalid ledger rows response')
        }
        rows.push(
          ...body
            .filter((item) => typeof item === 'object' && item !== null)
            .map((item) => ({
              ref: String(item.ref ?? ''),
              reason: String(item.reason ?? ''),
              delta: Number(item.delta ?? 0),
            })),
        )
        if (body.length < LEDGER_PAGE) return rows
      }
    },
    async readConfig(): Promise<EconomyConfig> {
      return loadEconomyConfig({ supabaseUrl: baseUrl, serviceRoleKey: options.serviceRoleKey })
    },
    apply: (entry: LedgerEntry) => options.ledger.apply(entry),
    // The service key never leaves the server, so it keys the wheel with no new secret to deploy.
    wheelSecret: options.serviceRoleKey,
  }
}

export async function loadEconomyConfig(client: EconomyRestClient): Promise<EconomyConfig> {
  const baseUrl = client.supabaseUrl.replace(/\/$/, '')
  const request = client.fetch ?? fetch
  const cacheKey = baseUrl
  const cached = configCache.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.loadedAt < CONFIG_TTL_MS) {
    return cached.value
  }
  const headers = {
    apikey: client.serviceRoleKey,
    authorization: `Bearer ${client.serviceRoleKey}`,
    'content-type': 'application/json',
  }
  const configUrl = new URL(`${baseUrl}/rest/v1/economy_config`)
  configUrl.searchParams.set('select', 'key,value')
  const configBody = await readJson(request, configUrl, headers)
  const bonusUrl = new URL(`${baseUrl}/rest/v1/economy_daily_streak_bonus`)
  bonusUrl.searchParams.set('select', 'calendar_day,bonus')
  const bonusBody = await readJson(request, bonusUrl, headers)
  const values = new Map<string, number>()
  if (Array.isArray(configBody)) {
    for (const item of configBody) {
      if (typeof item !== 'object' || item === null) continue
      const key = String(item.key ?? '')
      if (key !== '') values.set(key, Number(item.value ?? 0))
    }
  }
  const streakBonus: number[] = []
  if (Array.isArray(bonusBody)) {
    for (const item of bonusBody) {
      if (typeof item !== 'object' || item === null) continue
      const calendarDay = Number(item.calendar_day ?? 0)
      const bonus = Number(item.bonus ?? 0)
      if (calendarDay >= 1 && calendarDay <= 7) {
        streakBonus[calendarDay - 1] = bonus
      }
    }
  }
  const config: EconomyConfig = {
    signupBankroll: values.get('signup_bankroll') ?? 0,
    rescueFloor: values.get('rescue_floor') ?? 0,
    rescueThreshold: values.get('rescue_threshold') ?? 0,
    rescueDailyCap: values.get('rescue_daily_cap') ?? 0,
    dailyBase: values.get('daily_base') ?? 0,
    dailyStreakBonus: streakBonus,
  }
  configCache.set(cacheKey, { value: config, loadedAt: Date.now() })
  return config
}

async function readJson(
  request: typeof fetch,
  url: URL,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await request(url, { headers })
  const body = (await response.json()) as unknown
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String(body.message)
        : `Supabase request failed with ${response.status}`
    throw new Error(message)
  }
  return body
}
