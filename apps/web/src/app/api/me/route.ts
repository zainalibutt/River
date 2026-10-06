import { bearerToken, verifySession } from '@/lib/session-token'

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

export async function GET(request: Request): Promise<Response> {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return Response.json({ error: 'Not configured' }, { status: 503 })
  }

  const session = await verifySession(bearerToken(request), supabaseUrl)
  if (session === null) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const { playerId, anonymous, admin } = session
  const baseUrl = supabaseUrl.replace(/\/$/, '')

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
