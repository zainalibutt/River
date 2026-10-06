import { describe, expect, it } from 'vitest'
import { answerName, type NameClaimServices, supabaseNameClaim } from './name-claim'
import type { RiverSession } from './session-token'

/**
 * The route acts for the verified caller alone, keeps guests out of a choice
 * that is for keeps, refuses a name its rules refuse without asking the
 * database, and never lets "could not ask" read as "free" or "taken".
 */

const MEMBER: RiverSession = {
  playerId: '6f1c2c1e-6a3b-4a51-9f39-0d6e1d1b2a10',
  anonymous: false,
  admin: false,
}

function services(
  session: RiverSession | null,
  outcome: string | Error,
): NameClaimServices & {
  calls: { playerId: string; name: string; commit: boolean }[]
} {
  const calls: { playerId: string; name: string; commit: boolean }[] = []
  return {
    calls,
    session: async () => session,
    claim: async (playerId, name, commit) => {
      calls.push({ playerId, name, commit })
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
}

describe('asking about a name', () => {
  it('needs a signed-in member', async () => {
    expect((await answerName('', 'Zain', false, services(null, 'available'))).status).toBe(401)
    const guest = services({ ...MEMBER, anonymous: true }, 'available')
    const answer = await answerName('token', 'Zain', false, guest)
    expect(answer.status).toBe(403)
    expect(guest.calls).toEqual([])
  })

  it('refuses a name the rules refuse without asking the database', async () => {
    const asked = services(MEMBER, 'available')
    expect(await answerName('token', 'Nell', false, asked)).toEqual({
      status: 200,
      body: { status: 'reserved', name: 'Nell' },
    })
    expect(await answerName('token', 'Ze', true, asked)).toEqual({
      status: 200,
      body: { status: 'short', name: 'Ze' },
    })
    expect(asked.calls).toEqual([])
    expect((await answerName('token', 42, false, asked)).status).toBe(400)
  })

  it('checks for the caller alone, and only claims when asked to', async () => {
    const check = services(MEMBER, 'available')
    expect(await answerName('token', 'Zain', false, check)).toEqual({
      status: 200,
      body: { status: 'available', name: 'Zain' },
    })
    const claim = services(MEMBER, 'claimed')
    expect(await answerName('token', 'Zain', true, claim)).toEqual({
      status: 200,
      body: { status: 'claimed', name: 'Zain' },
    })
    expect(check.calls).toEqual([{ playerId: MEMBER.playerId, name: 'Zain', commit: false }])
    expect(claim.calls).toEqual([{ playerId: MEMBER.playerId, name: 'Zain', commit: true }])
  })

  it('passes on a taken name and a name already chosen', async () => {
    const taken = await answerName('token', 'Zain', true, services(MEMBER, 'taken'))
    expect(taken.body).toEqual({ status: 'taken', name: 'Zain' })
    const locked = await answerName('token', 'Zain', true, services(MEMBER, 'locked'))
    expect(locked.body).toEqual({ status: 'locked', name: 'Zain' })
  })

  it('never reads a failure as an answer', async () => {
    expect(
      (await answerName('token', 'Zain', false, services(MEMBER, new Error('down')))).status,
    ).toBe(503)
    expect((await answerName('token', 'Zain', false, services(MEMBER, 'maybe'))).status).toBe(502)
    expect((await answerName('token', 'Zain', false, services(MEMBER, 'missing'))).status).toBe(404)
    // The database's own shape check refusing a name reads as the same rule.
    expect((await answerName('token', 'Zain', false, services(MEMBER, 'invalid'))).body).toEqual({
      status: 'characters',
      name: 'Zain',
    })
  })
})

describe('the database call', () => {
  it('posts the player, the name and whether to commit, with the service role', async () => {
    const sent: { url: string; init: RequestInit }[] = []
    const request = (async (url: string, init: RequestInit) => {
      sent.push({ url, init })
      return new Response(JSON.stringify('available'), { status: 200 })
    }) as unknown as typeof fetch
    const claim = supabaseNameClaim('https://example.supabase.co/', 'service-key', request)
    expect(await claim(MEMBER.playerId, 'Zain', false)).toBe('available')
    expect(sent[0]?.url).toBe('https://example.supabase.co/rest/v1/rpc/claim_display_name')
    expect(sent[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      p_player_id: MEMBER.playerId,
      p_name: 'Zain',
      p_commit: false,
    })
    const headers = sent[0]?.init.headers as Record<string, string> | undefined
    expect(headers?.authorization).toBe('Bearer service-key')
  })

  it('throws rather than guess when the database does not answer properly', async () => {
    const failing = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    await expect(
      supabaseNameClaim('https://x.supabase.co', 'k', failing)('id', 'Zain', true),
    ).rejects.toThrow()
    const odd = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    await expect(
      supabaseNameClaim('https://x.supabase.co', 'k', odd)('id', 'Zain', true),
    ).rejects.toThrow()
  })
})
