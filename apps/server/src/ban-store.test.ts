import { describe, expect, it, vi } from 'vitest'
import { SupabaseBanList } from './ban-store.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const OTHER_ID = '0b6f1f0e-5c5e-4f0e-9d53-6a1f2f1f7a10'

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function listOver(request: typeof fetch, timeoutMs?: number): SupabaseBanList {
  return new SupabaseBanList({
    supabaseUrl: 'https://river.supabase.co/',
    serviceRoleKey: 'server-secret',
    fetch: request,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
}

describe('Supabase ban list', () => {
  it('reads one player with server-only credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([{ player_id: PLAYER_ID }]))
    await expect(listOver(request).isBanned(PLAYER_ID)).resolves.toBe(true)
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toBe(
      `https://river.supabase.co/rest/v1/player_bans?player_id=eq.${PLAYER_ID}&select=player_id`,
    )
    expect(init?.method).toBeUndefined()
    expect(init?.headers).toMatchObject({
      apikey: 'server-secret',
      authorization: 'Bearer server-secret',
    })
  })

  it('answers no for a player with no row', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([]))
    await expect(listOver(request).isBanned(PLAYER_ID)).resolves.toBe(false)
  })

  it('finds a ban whatever case the id arrives in', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([{ player_id: PLAYER_ID }]))
    await expect(listOver(request).isBanned(PLAYER_ID.toUpperCase())).resolves.toBe(true)
    expect(String(request.mock.calls[0]?.[0])).toContain(`player_id=eq.${PLAYER_ID}`)
  })

  it.each([
    ['an object', { player_id: PLAYER_ID }],
    ['nothing', null],
    ['two rows', [{ player_id: PLAYER_ID }, { player_id: PLAYER_ID }]],
    ['a row for another player', [{ player_id: OTHER_ID }]],
    ['a row with no id', [{}]],
    ['a row that is not a row', ['banned']],
  ])('refuses to read %s as an answer', async (_name, body) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(body))
    await expect(listOver(request).isBanned(PLAYER_ID)).rejects.toThrow('invalid ban')
  })

  it('throws rather than answering when Supabase refuses', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ message: 'relation does not exist' }, 404))
    await expect(listOver(request).isBanned(PLAYER_ID)).rejects.toThrow('relation does not exist')
  })

  it('throws when an error carries no readable body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(listOver(request).isBanned(PLAYER_ID)).rejects.toThrow('failed with 502')
  })

  it('throws when the network does', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'))
    await expect(listOver(request).isBanned(PLAYER_ID)).rejects.toThrow('fetch failed')
  })

  it('gives up on a call that does not answer in time', async () => {
    const request: typeof fetch = (_target, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    await expect(listOver(request, 20).isBanned(PLAYER_ID)).rejects.toThrow(
      'Supabase did not answer within 20ms',
    )
  })

  it('never sends anything that is not a player id', async () => {
    const request = vi.fn<typeof fetch>()
    const bans = listOver(request)
    await expect(bans.isBanned('not-a-player')).rejects.toThrow('player id')
    await expect(bans.setBanned(`${PLAYER_ID}&or=(1)`, true)).rejects.toThrow('player id')
    await expect(bans.setBanned('', false)).rejects.toThrow('player id')
    expect(request).not.toHaveBeenCalled()
  })

  it('bans with a write that a retry cannot double or overwrite', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(null, 201))
    await listOver(request).setBanned(PLAYER_ID.toUpperCase(), true)
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toBe('https://river.supabase.co/rest/v1/player_bans')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ player_id: PLAYER_ID })
    expect(init?.headers).toMatchObject({
      prefer: 'return=minimal,resolution=ignore-duplicates',
    })
  })

  it('lifts a ban by deleting that player and nobody else', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(null, 204))
    await listOver(request).setBanned(PLAYER_ID, false)
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toBe(
      `https://river.supabase.co/rest/v1/player_bans?player_id=eq.${PLAYER_ID}`,
    )
    expect(init?.method).toBe('DELETE')
  })

  it('reports a write Supabase refused', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ message: 'permission denied' }, 403))
    const bans = listOver(request)
    await expect(bans.setBanned(PLAYER_ID, true)).rejects.toThrow('permission denied')
    await expect(bans.setBanned(PLAYER_ID, false)).rejects.toThrow('permission denied')
  })

  it('lists every ban in order, a page at a time', async () => {
    const id = (index: number): string =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    const first = Array.from({ length: 500 }, (_unused, index) => ({ player_id: id(index) }))
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response([{ player_id: id(500) }]))
    const banned = await listOver(request).list()
    expect(banned).toHaveLength(501)
    expect(banned[0]).toBe(id(0))
    expect(banned[500]).toBe(id(500))
    expect(String(request.mock.calls[0]?.[0])).toContain('order=player_id.asc&limit=500&offset=0')
    expect(String(request.mock.calls[1]?.[0])).toContain('offset=500')
  })

  it('refuses a list it cannot read in full', async () => {
    const mixed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([{ player_id: PLAYER_ID }, { player_id: 7 }]))
    await expect(listOver(mixed).list()).rejects.toThrow('invalid ban row')
    const object = vi.fn<typeof fetch>().mockResolvedValue(response({}))
    await expect(listOver(object).list()).rejects.toThrow('invalid ban response')
  })
})
