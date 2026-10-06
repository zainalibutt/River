import { isNameStatus, type NameStatus, nameProblem } from '@/lib/player-name'
import type { RiverSession } from '@/lib/session-token'

/**
 * Checking and claiming a member's name, behind /api/name.
 *
 * Whether a name is free is the database's to say, because only it can say so
 * without a race between two people claiming one name; this part decides who
 * may ask and what they may ask for. A guest has no name to choose: a name is
 * for keeps, and a guest's account can be gone with a cleared browser.
 */

export interface NameClaimServices {
  session(token: string): Promise<RiverSession | null>
  /**
   * What claim_display_name says about `name` for this player, and with
   * `commit` the claim itself. See the locked_player_names migration.
   */
  claim(playerId: string, name: string, commit: boolean): Promise<string>
}

export interface NameAnswer {
  status: number
  body: { status: NameStatus; name: string } | { error: string }
}

export async function answerName(
  token: string,
  name: unknown,
  commit: boolean,
  services: NameClaimServices,
): Promise<NameAnswer> {
  const session = await services.session(token)
  if (session === null) return { status: 401, body: { error: 'Not authenticated' } }
  if (session.anonymous) {
    return {
      status: 403,
      body: { error: 'Sign in with your email to choose a name.' },
    }
  }
  if (typeof name !== 'string') return { status: 400, body: { error: 'That is not a name.' } }
  // The rules run before the database is asked, so a name they refuse is
  // never looked up at all.
  const problem = nameProblem(name)
  if (problem !== null) return { status: 200, body: { status: problem, name } }
  let outcome: string
  try {
    outcome = await services.claim(session.playerId, name, commit)
  } catch {
    return {
      status: 503,
      body: { error: 'Names cannot be checked right now.' },
    }
  }
  if (outcome === 'invalid') return { status: 200, body: { status: 'characters', name } }
  if (outcome === 'missing') {
    return { status: 404, body: { error: 'Your player could not be found.' } }
  }
  if (!isNameStatus(outcome)) {
    return {
      status: 502,
      body: { error: 'Names cannot be checked right now.' },
    }
  }
  return { status: 200, body: { status: outcome, name } }
}

/** claim_display_name, called with the service role as the server calls everything else. */
export function supabaseNameClaim(
  supabaseUrl: string,
  serviceRoleKey: string,
  request: typeof fetch = fetch,
): NameClaimServices['claim'] {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/claim_display_name`
  return async (playerId, name, commit) => {
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        p_player_id: playerId,
        p_name: name,
        p_commit: commit,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`Supabase name request failed with ${response.status}`)
    const outcome: unknown = await response.json()
    if (typeof outcome !== 'string') throw new Error('Supabase returned an invalid name outcome')
    return outcome
  }
}
