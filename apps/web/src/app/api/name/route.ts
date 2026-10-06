import {
  answerName,
  type NameAnswer,
  type NameClaimServices,
  supabaseNameClaim,
} from '@/lib/name-claim'
import { bearerToken, verifySession } from '@/lib/session-token'

/**
 * A member's name.
 *
 * GET /api/name?name=... asks whether the caller could claim a name, as it is
 * typed. POST /api/name with {"name": ...} claims it, once and for good. Both
 * act for the verified caller and never for a player id supplied to them.
 */

export const dynamic = 'force-dynamic'

function services(): NameClaimServices | null {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) return null
  return {
    session: (token) => verifySession(token, supabaseUrl),
    claim: supabaseNameClaim(supabaseUrl, serviceRoleKey),
  }
}

function reply(answer: NameAnswer): Response {
  return Response.json(answer.body, {
    status: answer.status,
    headers: { 'cache-control': 'no-store' },
  })
}

export async function GET(request: Request): Promise<Response> {
  const available = services()
  if (available === null) return reply({ status: 503, body: { error: 'Not configured' } })
  const name = new URL(request.url).searchParams.get('name') ?? undefined
  return reply(await answerName(bearerToken(request), name, false, available))
}

export async function POST(request: Request): Promise<Response> {
  const available = services()
  if (available === null) return reply({ status: 503, body: { error: 'Not configured' } })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return reply({ status: 400, body: { error: 'That is not a name.' } })
  }
  const name =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>).name : undefined
  return reply(await answerName(bearerToken(request), name, true, available))
}
