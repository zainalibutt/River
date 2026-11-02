import { actOnFriends, friendActionFrom, readFriends } from '@/lib/friends-server'
import { bearerToken, verifySession } from '@/lib/session-token'

/**
 * Friends for the verified caller: GET reads requests, friends, blocks and invitations;
 * POST makes one change. Only saved accounts take part: a guest is asked to save their
 * progress first. Every rule is in lib/friends-rules.ts.
 */

export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'no-store' }

async function caller(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    return Response.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const session = await verifySession(bearerToken(request), supabaseUrl)
  if (session === null) {
    return Response.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE })
  }
  if (session.anonymous) {
    return Response.json(
      { error: 'Save your progress to add friends.' },
      { status: 403, headers: NO_STORE },
    )
  }
  return { rest: { supabaseUrl, serviceRoleKey }, me: session.playerId }
}

export async function GET(request: Request): Promise<Response> {
  const who = await caller(request)
  if (who instanceof Response) return who
  try {
    return Response.json(await readFriends(who.rest, who.me, Date.now()), { headers: NO_STORE })
  } catch {
    return Response.json({ error: 'Friends are unavailable' }, { status: 502, headers: NO_STORE })
  }
}

export async function POST(request: Request): Promise<Response> {
  const who = await caller(request)
  if (who instanceof Response) return who
  const action = friendActionFrom(await request.json().catch(() => null))
  if (action === null) {
    return Response.json(
      { ok: false, message: 'Not understood.' },
      { status: 400, headers: NO_STORE },
    )
  }
  try {
    const result = await actOnFriends(who.rest, who.me, action, Date.now())
    return Response.json(result, { status: result.ok ? 200 : 409, headers: NO_STORE })
  } catch {
    return Response.json(
      { ok: false, message: 'That did not go through.' },
      { status: 502, headers: NO_STORE },
    )
  }
}
