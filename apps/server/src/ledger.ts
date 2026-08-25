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

function asSafeBalance(value: unknown): number {
  const balance = typeof value === 'string' ? Number(value) : value
  if (typeof balance !== 'number' || !Number.isSafeInteger(balance) || balance < 0) {
    throw new Error('Supabase returned an invalid bankroll balance')
  }
  return balance
}

export class SupabaseLedger implements Ledger {
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

  private async send(target: URL | string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.request(target, {
        ...init,
        headers: this.headers(),
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
}
