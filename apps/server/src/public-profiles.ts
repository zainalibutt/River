import { type ApiRoute, apiJson } from './api-routes.js'

/**
 * What anybody may see of a member. Nothing else leaves the server.
 *
 * Deliberately short. A profile could show level, reputation, hands played,
 * the biggest pot won and challenges completed, but River keeps none of those
 * past the seat they happen at, and a page is not the place to start.
 */
export interface PublicProfile {
  name: string
  /** The day this player first came to River, as YYYY-MM-DD. */
  memberSince: string
}

export interface PublicProfiles {
  /** The one member who goes by `name`, or null when nobody does, or more than one. */
  byName(name: string): Promise<PublicProfile | null>
}

/**
 * The players table's default name. Every player is given a generated name as
 * they arrive (see the generated_display_names migration), so this is left only
 * on a player the generator could not name, and it names nobody in particular.
 */
export const UNCHOSEN_NAME = 'Player'

const PREFIX = '/api/profiles/'
const LONGEST_NAME = 64
/** Players sharing one name beyond this are not told apart at all. */
const MOST_NAMESAKES = 10
const REQUEST_TIMEOUT_MS = 5_000

/**
 * GET /api/profiles/:name - a member's public profile.
 *
 * The answer is built field by field from the profile, never spread from a
 * row, so a column added to a query later cannot reach the browser by accident.
 * A guest, a name nobody has and a name two members share all read the same:
 * there is no such member.
 */
export function publicProfileRoute(profiles: PublicProfiles): ApiRoute {
  return {
    prefix: PREFIX,
    async handle(request) {
      const name = nameIn(new URL(request.url).pathname.slice(PREFIX.length))
      if (name === null) return apiJson({ error: 'That is not a player name.' }, 400)
      let profile: PublicProfile | null
      try {
        profile = await profiles.byName(name)
      } catch {
        return apiJson({ error: 'Profiles cannot be read right now.' }, 503)
      }
      if (profile === null) return apiJson({ error: 'No member goes by that name.' }, 404)
      return apiJson({ name: profile.name, memberSince: profile.memberSince })
    },
  }
}

function nameIn(segment: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(segment)
  } catch {
    return null
  }
  if (name.length === 0 || name.length > LONGEST_NAME || name.trim() !== name) return null
  return /[\p{Cc}/]/u.test(name) ? null : name
}

export interface SupabasePublicProfilesOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}

interface PlayerRow {
  id: string
  name: string
  createdAt: Date
}

function asPlayerRow(row: unknown): PlayerRow {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Supabase returned an invalid player row')
  }
  const record = row as Record<string, unknown>
  const createdAt = typeof record.created_at === 'string' ? new Date(record.created_at) : null
  if (
    typeof record.id !== 'string' ||
    typeof record.display_name !== 'string' ||
    createdAt === null ||
    Number.isNaN(createdAt.getTime())
  ) {
    throw new Error('Supabase returned a player row without an id, a name or a date')
  }
  return { id: record.id, name: record.display_name, createdAt }
}

/**
 * Profiles read with the service role, as the server reads everything else.
 *
 * Which accounts are members lives in Supabase Auth rather than in any table
 * the REST API can reach, so each player with the name is looked up there.
 * Only whether the account is anonymous is read from the answer.
 */
export class SupabasePublicProfiles implements PublicProfiles {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch

  constructor(options: SupabasePublicProfilesOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
  }

  async byName(name: string): Promise<PublicProfile | null> {
    if (name === UNCHOSEN_NAME) return null
    const query = new URL(`${this.baseUrl}/rest/v1/players`)
    query.searchParams.set('display_name', `eq.${name}`)
    query.searchParams.set('select', 'id,display_name,created_at')
    query.searchParams.set('limit', String(MOST_NAMESAKES + 1))
    const body = await this.read(query)
    if (!Array.isArray(body)) throw new Error('Supabase returned an invalid players response')
    if (body.length > MOST_NAMESAKES) return null
    const players = body.map(asPlayerRow)
    const membership = await Promise.all(players.map((row) => this.isMember(row.id)))
    const members = players.filter((_row, index) => membership[index] === true)
    const member = members.length === 1 ? members[0] : undefined
    if (member === undefined) return null
    return { name: member.name, memberSince: member.createdAt.toISOString().slice(0, 10) }
  }

  /** Whether an account has signed in with an address, rather than playing as a guest. */
  private async isMember(playerId: string): Promise<boolean> {
    const response = await this.request(
      `${this.baseUrl}/auth/v1/admin/users/${encodeURIComponent(playerId)}`,
      this.init(),
    )
    if (response.status === 404) return false
    const account = await this.parse(response)
    return (
      typeof account === 'object' &&
      account !== null &&
      (account as Record<string, unknown>).is_anonymous === false
    )
  }

  private async read(url: URL): Promise<unknown> {
    return this.parse(await this.request(url, this.init()))
  }

  private init(): RequestInit {
    return {
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  }

  private async parse(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new Error(`Supabase profile request failed with ${response.status}`)
    }
    return (await response.json()) as unknown
  }
}
