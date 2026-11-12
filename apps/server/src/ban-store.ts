import type { BanList } from './admin.js'

export interface SupabaseBanListOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  /** How long a Supabase call may take before it is treated as failed. */
  timeoutMs?: number
}

/**
 * Shorter than a chip movement gets. The check sits in front of every table
 * entry, and a player waiting at the door should hear "try again" quickly
 * rather than watch a spinner.
 */
const DEFAULT_TIMEOUT_MS = 5_000
/** Bans read at a time, well under the rows Supabase returns for one request. */
const BAN_PAGE = 500

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** A player id as the table holds it, so one player is never two rows apart by case. */
function asPlayerId(playerId: string): string {
  if (!UUID.test(playerId)) throw new Error('a ban needs a player id')
  return playerId.toLowerCase()
}

function bannedId(row: unknown): string {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Supabase returned an invalid ban row')
  }
  const { player_id: playerId } = row as Record<string, unknown>
  if (typeof playerId !== 'string' || !UUID.test(playerId)) {
    throw new Error('Supabase returned an invalid ban row')
  }
  return playerId.toLowerCase()
}

/**
 * The ban list kept in the database, so a restart forgets nobody.
 *
 * Every method throws when Supabase cannot be reached or answers with anything
 * but the shape asked for. It never guesses: whether an unanswered check lets a
 * player in is the caller's decision, and the hub refuses.
 */
export class SupabaseBanList implements BanList {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SupabaseBanListOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async isBanned(playerId: string): Promise<boolean> {
    const id = asPlayerId(playerId)
    const query = this.table()
    query.searchParams.set('player_id', `eq.${id}`)
    query.searchParams.set('select', 'player_id')
    const body = await this.read(await this.send(query))
    if (!Array.isArray(body) || body.length > 1) {
      throw new Error('Supabase returned an invalid ban response')
    }
    if (body.length === 0) return false
    // A row for somebody else means the filter was not applied, and that is
    // not an answer about this player.
    if (bannedId(body[0]) !== id) throw new Error('Supabase returned an invalid ban response')
    return true
  }

  /**
   * Banning twice keeps the first row and its date; lifting a ban that is not
   * there deletes nothing. Either can be retried safely.
   */
  async setBanned(playerId: string, banned: boolean): Promise<void> {
    const id = asPlayerId(playerId)
    if (banned) {
      const response = await this.send(
        this.table(),
        { method: 'POST', body: JSON.stringify({ player_id: id }) },
        { prefer: 'return=minimal,resolution=ignore-duplicates' },
      )
      await this.read(response)
      return
    }
    const query = this.table()
    query.searchParams.set('player_id', `eq.${id}`)
    await this.read(await this.send(query, { method: 'DELETE' }, { prefer: 'return=minimal' }))
  }

  async list(): Promise<string[]> {
    const banned: string[] = []
    for (let offset = 0; ; offset += BAN_PAGE) {
      const query = this.table()
      query.searchParams.set('select', 'player_id')
      query.searchParams.set('order', 'player_id.asc')
      query.searchParams.set('limit', String(BAN_PAGE))
      query.searchParams.set('offset', String(offset))
      const body = await this.read(await this.send(query))
      if (!Array.isArray(body)) throw new Error('Supabase returned an invalid ban response')
      banned.push(...body.map(bannedId))
      if (body.length < BAN_PAGE) return banned.sort()
    }
  }

  private table(): URL {
    return new URL(`${this.baseUrl}/rest/v1/player_bans`)
  }

  private async send(
    target: URL,
    init: RequestInit = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    try {
      return await this.request(target, {
        ...init,
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
          'content-type': 'application/json',
          ...extraHeaders,
        },
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
