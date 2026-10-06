import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Who a bearer token belongs to, for the routes that act for their caller.
 *
 * The token is verified rather than trusted: it is checked against the
 * project's JWKS, the same check the game server makes on connect, because a
 * route that believed a player id it was handed would act for anybody who
 * could name one.
 */
export interface RiverSession {
  playerId: string
  /** Playing as a guest, with no confirmed email behind the account. */
  anonymous: boolean
  admin: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let cachedKeySet: ReturnType<typeof createRemoteJWKSet> | null = null
let cachedIssuer = ''

function keySetFor(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  // createRemoteJWKSet caches and rotates keys internally, so it is built once
  // per issuer rather than per request. Rebuilding it every call would fetch
  // the key set on every page load.
  if (cachedKeySet === null || cachedIssuer !== issuer) {
    cachedKeySet = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    cachedIssuer = issuer
  }
  return cachedKeySet
}

/** The token after `Bearer `, or an empty string when there is none. */
export function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

/** The session behind `token`, or null for a missing, forged or expired one. */
export async function verifySession(
  token: string,
  supabaseUrl: string,
): Promise<RiverSession | null> {
  if (token.length === 0) return null
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`
  try {
    const { payload } = await jwtVerify(token, keySetFor(issuer), {
      issuer,
      audience: 'authenticated',
    })
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') return null
    if (!UUID.test(payload.sub)) return null
    const anonymous = payload.is_anonymous === true
    // app_metadata only, and never for an anonymous session. See auth.ts in the
    // server for why user_metadata is not a source of authority.
    const appMetadata = payload.app_metadata
    const admin =
      !anonymous &&
      typeof appMetadata === 'object' &&
      appMetadata !== null &&
      (appMetadata as Record<string, unknown>).river_role === 'developer'
    return { playerId: payload.sub, anonymous, admin }
  } catch {
    return null
  }
}
