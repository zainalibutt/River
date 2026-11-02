import { claimDailyChips, readEconomyStatus } from '@/lib/economy-rest'
import { bearerToken, verifySession } from '@/lib/session-token'

/**
 * Daily chips from the club menu: GET says what can be claimed and when the next claim
 * opens, POST claims it. Both act only for the verified subject of the caller's token,
 * never for an id the caller names. See lib/economy-rest.ts for why this is safe beside
 * the table's own claim.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

async function caller(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) return 'unconfigured' as const
  const session = await verifySession(bearerToken(request), supabaseUrl)
  if (session === null) return 'unauthenticated' as const
  return { rest: { supabaseUrl, serviceRoleKey }, playerId: session.playerId }
}

function refused(reason: 'unconfigured' | 'unauthenticated'): Response {
  return reason === 'unconfigured'
    ? Response.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
    : Response.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE })
}

export async function GET(request: Request): Promise<Response> {
  const who = await caller(request)
  if (typeof who === 'string') return refused(who)
  try {
    const status = await readEconomyStatus(who.rest, who.playerId, Date.now())
    return Response.json({ status }, { headers: NO_STORE })
  } catch {
    return Response.json(
      { error: 'Daily chips are unavailable' },
      { status: 502, headers: NO_STORE },
    )
  }
}

export async function POST(request: Request): Promise<Response> {
  const who = await caller(request)
  if (typeof who === 'string') return refused(who)
  try {
    return Response.json(await claimDailyChips(who.rest, who.playerId, Date.now()), {
      headers: NO_STORE,
    })
  } catch {
    return Response.json(
      { error: 'The claim did not go through' },
      { status: 502, headers: NO_STORE },
    )
  }
}
