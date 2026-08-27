import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Who the caller is, and what they have.
 *
 * The menu needs a bankroll and needs to know whether to show the developer
 * route, and neither is readable from the browser. `chip_ledger` has RLS on
 * with no policies and `player_balances` is a security-invoker view that grants
 * SELECT to neither anon nor authenticated - which is correct, and means the
 * only way to a balance is a server that holds the service key.
 *
 * The alternative was opening a WebSocket from the main menu purely to read one
 * number, which would seat a connection for somebody who has not chosen a table
 * yet.
 *
 * The token is verified rather than trusted. A caller supplies a bearer token
 * and we check it against the project's JWKS - the same check the game server
 * makes on connect - because otherwise this route hands any player's balance to
 * anyone who can name their id.
 */

export const dynamic = 'force-dynamic'

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

export async function GET(request: Request): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return Response.json({ error: 'Not configured' }, { status: 503 })
  }

  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (token.length === 0) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const baseUrl = supabaseUrl.replace(/\/$/, '')
  const issuer = `${baseUrl}/auth/v1`
  let playerId: string
  let anonymous: boolean
  let admin: boolean
  try {
    const { payload } = await jwtVerify(token, keySetFor(issuer), {
      issuer,
      audience: 'authenticated',
    })
    if (payload.role !== 'authenticated' || typeof payload.sub !== 'string') {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }
    if (!UUID.test(payload.sub)) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }
    playerId = payload.sub
    anonymous = payload.is_anonymous === true
    // app_metadata only, and never for an anonymous session. See auth.ts in the
    // server for why user_metadata is not a source of authority.
    const appMetadata = payload.app_metadata
    admin =
      !anonymous &&
      typeof appMetadata === 'object' &&
      appMetadata !== null &&
      (appMetadata as Record<string, unknown>).river_role === 'developer'
  } catch {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // The balance is read for the verified subject and never for an id the caller
  // supplied, so a valid token cannot be pointed at somebody else's bankroll.
  let balance = 0
  try {
    const query = new URL(`${baseUrl}/rest/v1/player_balances`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('select', 'balance')
    const response = await fetch(query, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
    if (response.ok) {
      const rows = (await response.json()) as { balance?: number }[]
      const row = rows[0]
      if (row !== undefined && Number.isFinite(row.balance)) balance = Number(row.balance)
    }
  } catch {
    // A bankroll that cannot be read is shown as unknown by the client rather
    // than as zero. Reporting zero would tell somebody they are broke because a
    // request timed out.
    return Response.json(
      { playerId, anonymous, admin, balance: null },
      { headers: { 'cache-control': 'no-store' } },
    )
  }

  return Response.json(
    { playerId, anonymous, admin, balance },
    { headers: { 'cache-control': 'no-store' } },
  )
}
