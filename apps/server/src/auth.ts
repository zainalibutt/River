import type { JWTPayload, JWTVerifyGetKey } from 'jose'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AuthenticatedPlayer {
  playerId: string
  anonymous: boolean
  /**
   * Whether this player holds the developer role.
   *
   * Read from the signed token rather than looked up, so the check costs
   * nothing on the connection path and cannot be stale. Granting it is a
   * service-role operation - see supabase/migrations for the statement.
   */
  admin: boolean
}

export type TokenVerifier = (token: string) => Promise<AuthenticatedPlayer>

export interface SupabaseTokenVerifierOptions {
  supabaseUrl: string
  getKey?: JWTVerifyGetKey
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Whether the token carries the developer role.
 *
 * `app_metadata` and nothing else. Supabase puts two metadata objects in every
 * token and only one of them is trustworthy: `user_metadata` is writable by the
 * user themselves through `auth.updateUser`, so a role read from there is a
 * role anybody can hand themselves by editing their own profile. `app_metadata`
 * can only be written with the service key.
 *
 * An anonymous session is never a developer regardless of what it carries.
 * Anonymous sessions are handed out to anyone who loads the page, so if one
 * ever arrives holding the claim, something upstream is wrong and the answer is
 * still no.
 */
function isDeveloperClaim(payload: JWTPayload): boolean {
  if (payload.is_anonymous === true) return false
  const appMetadata = payload.app_metadata
  if (typeof appMetadata !== 'object' || appMetadata === null) return false
  return (appMetadata as Record<string, unknown>).river_role === 'developer'
}

function playerFromClaims(payload: JWTPayload): AuthenticatedPlayer {
  if (payload.role !== 'authenticated') {
    throw new Error('token is not an authenticated Supabase session')
  }
  if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
    throw new Error('token has no valid player id')
  }
  return {
    playerId: payload.sub,
    anonymous: payload.is_anonymous === true,
    admin: isDeveloperClaim(payload),
  }
}

export function createSupabaseTokenVerifier(options: SupabaseTokenVerifierOptions): TokenVerifier {
  const baseUrl = options.supabaseUrl.replace(/\/$/, '')
  const issuer = `${baseUrl}/auth/v1`
  const getKey = options.getKey ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  return async (token) => {
    if (token.length === 0) {
      throw new Error('missing access token')
    }
    const { payload } = await jwtVerify(token, getKey, {
      issuer,
      audience: 'authenticated',
    })
    return playerFromClaims(payload)
  }
}
