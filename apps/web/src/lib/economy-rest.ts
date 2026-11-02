import {
  claimDaily,
  deriveEconomyState,
  type EconomyConfig,
  type EconomyStatus,
  economyStatus,
  type LedgerRow,
} from '@river/engine'

/**
 * Daily chips for the club menu, read and claimed with the service key.
 *
 * The game server grants daily chips over the table's socket; the menu has no socket, and
 * opening one to claim a reward would seat a connection for somebody who has not chosen a
 * table. This reads the same ledger, decides with the same engine rules and writes through
 * the same `apply_ledger_entry` function. A daily grant's ref is the player and the UTC day,
 * which the ledger refuses to apply twice, so a claim here and one at the table on the same
 * day pay once between them. Rescues stay at the table, where the server knows who is seated.
 */

export interface EconomyRest {
  supabaseUrl: string
  serviceRoleKey: string
}

function headers(rest: EconomyRest): Record<string, string> {
  return {
    apikey: rest.serviceRoleKey,
    authorization: `Bearer ${rest.serviceRoleKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

async function readJson(rest: EconomyRest, url: URL): Promise<unknown> {
  const response = await fetch(url, {
    headers: headers(rest),
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`Supabase read failed with ${response.status}`)
  return response.json() as Promise<unknown>
}

function base(rest: EconomyRest): string {
  return rest.supabaseUrl.replace(/\/$/, '')
}

async function readRows(rest: EconomyRest, playerId: string): Promise<LedgerRow[]> {
  const query = new URL(`${base(rest)}/rest/v1/chip_ledger`)
  query.searchParams.set('player_id', `eq.${playerId}`)
  query.searchParams.set('select', 'ref,reason,delta')
  const body = await readJson(rest, query)
  if (!Array.isArray(body)) throw new Error('Supabase returned an invalid ledger')
  return body.map((item: Record<string, unknown>) => ({
    ref: String(item.ref ?? ''),
    reason: String(item.reason ?? ''),
    delta: Number(item.delta ?? 0),
  }))
}

async function readConfig(rest: EconomyRest): Promise<EconomyConfig> {
  const configUrl = new URL(`${base(rest)}/rest/v1/economy_config`)
  configUrl.searchParams.set('select', 'key,value')
  const bonusUrl = new URL(`${base(rest)}/rest/v1/economy_daily_streak_bonus`)
  bonusUrl.searchParams.set('select', 'calendar_day,bonus')
  const [configBody, bonusBody] = await Promise.all([
    readJson(rest, configUrl),
    readJson(rest, bonusUrl),
  ])
  const values = new Map<string, number>()
  for (const item of Array.isArray(configBody) ? configBody : []) {
    const key = String(item?.key ?? '')
    if (key !== '') values.set(key, Number(item?.value ?? 0))
  }
  const streakBonus: number[] = []
  for (const item of Array.isArray(bonusBody) ? bonusBody : []) {
    const day = Number(item?.calendar_day ?? 0)
    if (day >= 1 && day <= 7) streakBonus[day - 1] = Number(item?.bonus ?? 0)
  }
  return {
    signupBankroll: values.get('signup_bankroll') ?? 0,
    rescueFloor: values.get('rescue_floor') ?? 0,
    rescueThreshold: values.get('rescue_threshold') ?? 0,
    rescueDailyCap: values.get('rescue_daily_cap') ?? 0,
    dailyBase: values.get('daily_base') ?? 0,
    dailyStreakBonus: streakBonus,
  }
}

/** What this player could claim now. Seated is unknown here, so the rescue is never offered. */
export async function readEconomyStatus(
  rest: EconomyRest,
  playerId: string,
  nowMs: number,
): Promise<EconomyStatus> {
  const [rows, config] = await Promise.all([readRows(rest, playerId), readConfig(rest)])
  const state = { ...deriveEconomyState(rows, true, nowMs), playerId }
  return economyStatus(state, config, nowMs)
}

export type DailyClaim =
  | { kind: 'granted'; delta: number; balance: number; status: EconomyStatus }
  | { kind: 'already-claimed'; status: EconomyStatus }

/** Claims today's daily chips for this player, once, by the engine's rule. */
export async function claimDailyChips(
  rest: EconomyRest,
  playerId: string,
  nowMs: number,
): Promise<DailyClaim> {
  const [rows, config] = await Promise.all([readRows(rest, playerId), readConfig(rest)])
  const state = { ...deriveEconomyState(rows, true, nowMs), playerId }
  const decision = claimDaily(state, config, nowMs)
  if (decision === null) {
    return { kind: 'already-claimed', status: economyStatus(state, config, nowMs) }
  }
  const response = await fetch(`${base(rest)}/rest/v1/rpc/apply_ledger_entry`, {
    method: 'POST',
    headers: headers(rest),
    cache: 'no-store',
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      p_player_id: playerId,
      p_delta: decision.delta,
      p_reason: decision.reason,
      p_ref: decision.ref,
    }),
  })
  if (!response.ok) throw new Error(`The ledger refused the claim with ${response.status}`)
  const balance = Number(await response.json())
  return {
    kind: 'granted',
    delta: decision.delta,
    balance: Number.isFinite(balance) ? balance : state.balance + decision.delta,
    status: economyStatus(decision.nextState, config, nowMs),
  }
}
