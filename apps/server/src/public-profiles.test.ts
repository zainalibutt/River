import { describe, expect, it } from 'vitest'
import { publicProfileRoute, SupabasePublicProfiles } from './public-profiles.js'

/**
 * A profile page is public, and the rows behind it are not.
 *
 * The service role reads past every policy Supabase has, so what reaches the
 * browser is decided here and nowhere else. These run the route against the
 * real Supabase reader, fed rows that carry more than a profile shows, to
 * prove that nothing but the profile comes out the other side.
 */

const ZAIN = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const GUEST = '78047f44-a536-4861-9d8f-784d77bda917'
const OTHER = 'c1f9a4de-1f0b-4d4a-8a2c-2b6f0e5a7d31'

/** A player row, as it would come back had the query asked for everything. */
function player(id: string, name: string, createdAt = '2026-08-23T09:12:44.123+00:00') {
  return {
    id,
    display_name: name,
    created_at: createdAt,
    email: 'zain@example.com',
    balance: 152_340,
    wins: 41,
  }
}

/** An account as Supabase Auth describes it to the service role. */
function account(id: string, anonymous: boolean) {
  return {
    id,
    email: anonymous ? '' : 'zain@example.com',
    phone: '',
    is_anonymous: anonymous,
    app_metadata: { provider: 'email', river_role: 'developer' },
    user_metadata: { email_verified: true },
    last_sign_in_at: '2026-09-29T08:00:00Z',
  }
}

interface Backend {
  players?: unknown
  playersStatus?: number
  accounts?: Record<string, unknown>
  accountStatus?: number
}

/** The profile route over a Supabase that answers from `backend`, noting what it was asked. */
function profiles(backend: Backend) {
  const asked: URL[] = []
  const request = (async (input: URL | string) => {
    const url = new URL(input.toString())
    asked.push(url)
    if (url.pathname === '/rest/v1/players') {
      return Response.json(backend.players ?? [], { status: backend.playersStatus ?? 200 })
    }
    const id = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(url.pathname)?.[1]
    const found = id === undefined ? undefined : backend.accounts?.[id]
    if (backend.accountStatus !== undefined) {
      return Response.json({ msg: 'unavailable' }, { status: backend.accountStatus })
    }
    return found === undefined
      ? Response.json({ msg: 'User not found' }, { status: 404 })
      : Response.json(found)
  }) as unknown as typeof fetch
  const route = publicProfileRoute(
    new SupabasePublicProfiles({
      supabaseUrl: 'https://example.supabase.co/',
      serviceRoleKey: 'service-role',
      fetch: request,
    }),
  )
  const visit = (name: string) =>
    route.handle(new Request(`http://river.test/api/profiles/${name}`))
  return { visit, asked }
}

describe('a public profile', () => {
  it('shows a member their name and when they first came, and nothing else', async () => {
    const { visit } = profiles({
      players: [player(ZAIN, 'Zain')],
      accounts: { [ZAIN]: account(ZAIN, false) },
    })
    const response = await visit('Zain')
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ name: 'Zain', memberSince: '2026-08-23' })
    for (const secret of [ZAIN, 'example.com', '152340', 'developer', 'is_anonymous', '41']) {
      expect(text).not.toContain(secret)
    }
  })

  it('asks Supabase for only the columns a profile shows', async () => {
    const { visit, asked } = profiles({
      players: [player(ZAIN, 'Zain')],
      accounts: { [ZAIN]: account(ZAIN, false) },
    })
    await visit('Zain')
    const query = asked.find((url) => url.pathname === '/rest/v1/players')
    expect(query?.searchParams.get('select')).toBe('id,display_name,created_at')
    expect(query?.searchParams.get('display_name')).toBe('eq.Zain')
  })

  it('reads a name with a space in it', async () => {
    const { visit, asked } = profiles({
      players: [player(ZAIN, 'Zain Butt')],
      accounts: { [ZAIN]: account(ZAIN, false) },
    })
    expect(await (await visit('Zain%20Butt')).json()).toEqual({
      name: 'Zain Butt',
      memberSince: '2026-08-23',
    })
    expect(asked[0]?.searchParams.get('display_name')).toBe('eq.Zain Butt')
  })

  it('does not show a guest', async () => {
    const { visit } = profiles({
      players: [player(GUEST, 'Guesty')],
      accounts: { [GUEST]: account(GUEST, true) },
    })
    const response = await visit('Guesty')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'No member goes by that name.' })
  })

  it('does not show a name nobody goes by', async () => {
    const { visit } = profiles({ players: [] })
    expect((await visit('Nobody')).status).toBe(404)
  })

  it('treats the name every player starts with as nobody in particular', async () => {
    // Every account is created as Player and nothing in River renames it yet,
    // so this name belongs to everyone who has not chosen another.
    const { visit, asked } = profiles({
      players: [player(ZAIN, 'Player')],
      accounts: { [ZAIN]: account(ZAIN, false) },
    })
    expect((await visit('Player')).status).toBe(404)
    expect(asked).toEqual([])
  })

  it('does not choose between two members who share a name', async () => {
    const { visit } = profiles({
      players: [player(ZAIN, 'Zain'), player(OTHER, 'Zain')],
      accounts: { [ZAIN]: account(ZAIN, false), [OTHER]: account(OTHER, false) },
    })
    expect((await visit('Zain')).status).toBe(404)
  })

  it('does not let a guest who took a member name hide the member', async () => {
    const { visit } = profiles({
      players: [player(GUEST, 'Zain', '2026-07-01T00:00:00Z'), player(ZAIN, 'Zain')],
      accounts: { [GUEST]: account(GUEST, true), [ZAIN]: account(ZAIN, false) },
    })
    expect(await (await visit('Zain')).json()).toEqual({ name: 'Zain', memberSince: '2026-08-23' })
  })

  it('refuses a name that cannot be one without asking Supabase', async () => {
    const { visit, asked } = profiles({ players: [player(ZAIN, 'Zain')] })
    for (const name of ['', '%20Zain', 'Zain%20', 'a%2Fb', 'Za%07in', 'x'.repeat(65), '%E0%A4%A']) {
      const response = await visit(name)
      expect(response.status, name).toBe(400)
      expect(await response.json()).toEqual({ error: 'That is not a player name.' })
    }
    expect(asked).toEqual([])
  })

  it('says profiles are unavailable, not that nobody exists, when Supabase fails', async () => {
    const failures: Backend[] = [
      { playersStatus: 500 },
      { players: [player(ZAIN, 'Zain')], accountStatus: 500 },
      { players: [{ id: ZAIN, display_name: 'Zain' }] },
    ]
    for (const backend of failures) {
      const response = await profiles(backend).visit('Zain')
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Profiles cannot be read right now.' })
    }
  })

  it('is never cached, so a guest who signs up is found straight away', async () => {
    const { visit } = profiles({
      players: [player(ZAIN, 'Zain')],
      accounts: { [ZAIN]: account(ZAIN, false) },
    })
    for (const name of ['Zain', 'Nobody', 'Player']) {
      expect((await visit(name)).headers.get('cache-control')).toBe('no-store')
    }
  })
})
