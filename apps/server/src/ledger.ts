export interface LedgerEntry {
  playerId: string
  delta: number
  reason: string
  ref: string
}

export interface Ledger {
  balance(playerId: string): Promise<number>
  apply(entry: LedgerEntry): Promise<number>
}

/** One person's time in one seat, from the buy-in that opened it to whatever ended it. */
export interface Seating {
  playerId: string
  /**
   * The sit's `${roomId}:${requestId}`. The payments that settle the seating
   * by name - at a shutdown, an expired reconnect, a crash - are named after it.
   */
  ref: string
  /** What the seat has cost: its buy-in and every rebuy since. */
  buyIn: number
  /** When it opened, by the clock of the server that opened it. */
  openedAtMs: number
}

/**
 * Which seatings are open, kept beside the chip ledger rather than in it.
 *
 * The ledger alone cannot say which seats a crash left unpaid. A seat that ends
 * with nothing left moves no chips, so nothing there says it ended, and every
 * player who busted and left would look like one a crash had taken. The credits
 * that end a seat by standing, leaving or a kick are named after the request,
 * not the seating, so matching them back to one would mean trusting the order
 * of entries and an id the client chose. So a seating is written down when it
 * opens and again when it ends, whatever it had left, and a seat stays a seat
 * operation rather than becoming a chip one.
 */
export interface SeatingStore {
  /** A seating opened, or a rebuy grew it. Writing one again never reopens it. */
  open(seating: Seating): Promise<void>
  /** A seating ended, with chips or without. */
  close(seating: Seating): Promise<void>
  /** Seatings opened before `openedBeforeMs` that never ended. */
  unsettled(openedBeforeMs: number): Promise<Seating[]>
}

export interface SupabaseLedgerOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  /** How long a Supabase call may take before it is treated as failed. */
  timeoutMs?: number
}

/**
 * Long enough for a slow round trip, short enough that a player notices a
 * refusal rather than a spinner. A request with no deadline is worse than a
 * failed one: the socket that is waiting on it never answers, and the whole
 * connection reads as broken with nothing logged to say why.
 */
const DEFAULT_TIMEOUT_MS = 8_000
/** Open seatings read at a time, well under the rows Supabase returns for one request. */
const SEATING_PAGE = 500

function asSafeBalance(value: unknown): number {
  const balance = typeof value === 'string' ? Number(value) : value
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) {
    throw new Error('Supabase returned an invalid bankroll balance')
  }
  return balance
}

function seatingRow(seating: Seating): Record<string, unknown> {
  return {
    player_id: seating.playerId,
    ref: seating.ref,
    buy_in: seating.buyIn,
    opened_at: new Date(seating.openedAtMs).toISOString(),
  }
}

/** A row the refund would pay out on, read strictly: a guess is never refunded. */
function asSeating(row: unknown): Seating {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Supabase returned an invalid seating row')
  }
  const {
    player_id: playerId,
    ref,
    buy_in: rawBuyIn,
    opened_at: openedAt,
  } = row as Record<string, unknown>
  const buyIn = typeof rawBuyIn === 'string' ? Number(rawBuyIn) : rawBuyIn
  const openedAtMs = typeof openedAt === 'string' ? Date.parse(openedAt) : Number.NaN
  if (
    typeof playerId !== 'string' ||
    typeof ref !== 'string' ||
    ref.length === 0 ||
    typeof buyIn !== 'number' ||
    !Number.isSafeInteger(buyIn) ||
    buyIn <= 0 ||
    !Number.isFinite(openedAtMs)
  ) {
    throw new Error('Supabase returned an invalid seating row')
  }
  return { playerId, ref, buyIn, openedAtMs }
}

export class SupabaseLedger implements Ledger, SeatingStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SupabaseLedgerOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async balance(playerId: string): Promise<number> {
    const query = new URL(`${this.baseUrl}/rest/v1/player_balances`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('select', 'balance')
    const response = await this.send(query)
    const body = await this.read(response)
    if (!Array.isArray(body) || body.length > 1) {
      throw new Error('Supabase returned an invalid bankroll response')
    }
    const row = body[0]
    if (row === undefined) {
      return 0
    }
    if (typeof row !== 'object' || row === null || !('balance' in row)) {
      throw new Error('Supabase returned an invalid bankroll row')
    }
    return asSafeBalance(row.balance)
  }

  async apply(entry: LedgerEntry): Promise<number> {
    if (!Number.isSafeInteger(entry.delta) || entry.delta === 0) {
      throw new Error('ledger delta must be a non-zero safe integer')
    }
    const response = await this.send(`${this.baseUrl}/rest/v1/rpc/apply_ledger_entry`, {
      method: 'POST',
      body: JSON.stringify({
        p_player_id: entry.playerId,
        p_delta: entry.delta,
        p_reason: entry.reason,
        p_ref: entry.ref,
      }),
    })
    return asSafeBalance(await this.read(response))
  }

  async open(seating: Seating): Promise<void> {
    await this.writeSeating(seatingRow(seating))
  }

  async close(seating: Seating): Promise<void> {
    await this.writeSeating({ ...seatingRow(seating), closed_at: new Date().toISOString() })
  }

  async unsettled(openedBeforeMs: number): Promise<Seating[]> {
    const seatings: Seating[] = []
    for (let offset = 0; ; offset += SEATING_PAGE) {
      const query = new URL(`${this.baseUrl}/rest/v1/table_seatings`)
      query.searchParams.set('select', 'player_id,ref,buy_in,opened_at')
      query.searchParams.set('closed_at', 'is.null')
      query.searchParams.set('opened_at', `lt.${new Date(openedBeforeMs).toISOString()}`)
      query.searchParams.set('order', 'opened_at.asc,player_id.asc,ref.asc')
      query.searchParams.set('limit', String(SEATING_PAGE))
      query.searchParams.set('offset', String(offset))
      const body = await this.read(await this.send(query))
      if (!Array.isArray(body)) throw new Error('Supabase returned an invalid seating response')
      seatings.push(...body.map(asSeating))
      if (body.length < SEATING_PAGE) return seatings
    }
  }

  /**
   * One row per player and seating, merged on a second write. Only the columns
   * written change, so writing an open seating again leaves a closed one closed
   * - which also makes a close that lands before its open's retry stay closed.
   */
  private async writeSeating(row: Record<string, unknown>): Promise<void> {
    const response = await this.send(
      `${this.baseUrl}/rest/v1/table_seatings`,
      { method: 'POST', body: JSON.stringify(row) },
      { prefer: 'return=minimal,resolution=merge-duplicates' },
    )
    await this.read(response)
  }

  private async send(
    target: URL | string,
    init: RequestInit = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    try {
      return await this.request(target, {
        ...init,
        headers: { ...this.headers(), ...extraHeaders },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new Error(`Supabase did not answer within ${this.timeoutMs}ms`)
      }
      throw error
    }
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      'content-type': 'application/json',
    }
  }

  private async read(response: Response): Promise<unknown> {
    // A write asked for nothing back answers with an empty body.
    const text = await response.text()
    let body: unknown = null
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown
      } catch (error) {
        if (response.ok) throw error
      }
    }
    if (!response.ok) {
      const message =
        typeof body === 'object' && body !== null && 'message' in body
          ? String(body.message)
          : `Supabase request failed with ${response.status}`
      throw new Error(message)
    }
    return body
  }
}
