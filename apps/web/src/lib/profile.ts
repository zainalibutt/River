/**
 * A member's public profile, as the profile page draws it.
 *
 * The server decides what is public; this side only asks and draws. See
 * apps/server/src/public-profiles.ts for which fields leave the server and why
 * there are so few of them.
 */
export interface PublicProfile {
  name: string
  /** The day this player first came to River, as YYYY-MM-DD. */
  memberSince: string
}

/** What asking for a profile came to. */
export type ProfileOutcome =
  | { kind: 'found'; profile: PublicProfile }
  | { kind: 'missing' }
  | { kind: 'unavailable' }

/**
 * The players table's default name. Players are given a generated name as they
 * arrive, so this is left only on one the generator could not name, and it
 * names nobody.
 */
const UNCHOSEN_NAME = 'Player'

/** Where a member's profile lives, or null when that name can have no page. */
export function profilePath(name: string): string | null {
  if (name.length === 0 || name === UNCHOSEN_NAME) return null
  return `/p/${encodeURIComponent(name)}`
}

export async function loadProfile(
  name: string,
  request: typeof fetch = fetch,
): Promise<ProfileOutcome> {
  let body: unknown
  try {
    const response = await request(`/api/profiles/${encodeURIComponent(name)}`, {
      cache: 'no-store',
    })
    if (response.status === 404 || response.status === 400) return { kind: 'missing' }
    if (!response.ok) return { kind: 'unavailable' }
    body = await response.json()
  } catch {
    return { kind: 'unavailable' }
  }
  if (typeof body !== 'object' || body === null) return { kind: 'unavailable' }
  const record = body as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.memberSince !== 'string') {
    return { kind: 'unavailable' }
  }
  return { kind: 'found', profile: { name: record.name, memberSince: record.memberSince } }
}

/** "August 2026". The day is kept by the server but is more than a profile needs to say. */
export function memberSinceLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
