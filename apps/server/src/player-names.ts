import { UNCHOSEN_NAME } from './public-profiles.js'

/**
 * The name a member sits at a table under.
 *
 * A guest sits under the name their client sends. A member sits under the name
 * on their account, read here rather than trusted from the client: the one
 * they chose, or the one generated for them when they arrived, which their
 * public profile already goes by. Null means there is no such name to use, and
 * the seat keeps the name the client sent.
 */
export interface PlayerNames {
  seatName(playerId: string): Promise<string | null>
}

export interface SupabasePlayerNamesOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  /** Sitting down never waits longer than this on a name. */
  timeoutMs?: number
}

/** The shape the players table holds every name to (players_display_name_shape). */
const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/

export class SupabasePlayerNames implements PlayerNames {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SupabasePlayerNamesOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 2_000
  }

  async seatName(playerId: string): Promise<string | null> {
    const query = new URL(`${this.baseUrl}/rest/v1/players`)
    query.searchParams.set('id', `eq.${playerId}`)
    query.searchParams.set('select', 'display_name')
    const response = await this.request(query, {
      headers: { apikey: this.serviceRoleKey, authorization: `Bearer ${this.serviceRoleKey}` },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`Supabase request failed with ${response.status}`)
    const body = (await response.json()) as unknown
    if (!Array.isArray(body)) throw new Error('Supabase returned an invalid players response')
    const name = (body[0] as { display_name?: unknown } | undefined)?.display_name
    if (typeof name !== 'string' || name === UNCHOSEN_NAME || !NAME_SHAPE.test(name)) return null
    return name
  }
}
