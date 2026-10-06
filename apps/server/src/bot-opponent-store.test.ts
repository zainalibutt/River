import { describe, expect, it, vi } from 'vitest'
import { SupabaseBotOpponentStore } from './bot-opponent-store.js'

const PLAYER_ID = 'd6c24116-b478-4847-93c2-1839f876b8da'
const evidence = {
  vpip: true,
  pfr: true,
  aggressiveActions: 1,
  passiveCalls: 0,
  showdown: false,
  aggressivePotRatios: [0.75],
}

describe('SupabaseBotOpponentStore', () => {
  it('appends one bot-owned public observation with database idempotency', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }))
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await store.append({
      botId: 'albie',
      playerId: PLAYER_ID,
      handKey: 'room-1:12:commit',
      observedAtMs: Date.UTC(2026, 8, 22),
      evidence,
    })
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toBe('https://example.supabase.co/rest/v1/bot_opponent_observations')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer server-secret',
      Prefer: 'resolution=ignore-duplicates',
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      bot_id: 'albie',
      player_id: PLAYER_ID,
      model_version: 1,
      hand_key: 'room-1:12:commit',
      evidence,
    })
  })

  it('replays a bot and human pair from oldest to newest', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([
          {
            hand_key: 'old',
            observed_at: '2026-09-21T00:00:00.000Z',
            evidence: { ...evidence, vpip: false, pfr: false },
          },
          { hand_key: 'new', observed_at: '2026-09-22T00:00:00.000Z', evidence },
        ]),
      )
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    const state = await store.load('albie', PLAYER_ID)
    expect(state?.weightedHands).toBeGreaterThan(1)
    expect(state?.weightedHands).toBeLessThan(2)
    expect(state?.weightedVpip).toBe(1)
    expect(state?.lastSeenAtMs).toBe(Date.UTC(2026, 8, 22))
    const [url] = request.mock.calls[1] ?? []
    expect(String(url)).toContain('bot_id=eq.albie')
    expect(String(url)).toContain(`player_id=eq.${PLAYER_ID}`)
    expect(String(url)).not.toContain('or=')
  })

  it('starts from a checkpoint and replays only the evidence after it', async () => {
    const checkpointState = {
      version: 1,
      weightedHands: 40,
      weightedVpip: 10,
      weightedPfr: 5,
      weightedAggressiveActions: 8,
      weightedPassiveCalls: 12,
      weightedShowdowns: 4,
      weightedAggressivePotRatioTotal: 6,
      weightedAggressivePotRatioSamples: 8,
      lastSeenAtMs: Date.UTC(2026, 8, 22),
    }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          {
            state: checkpointState,
            folded_through_at: '2026-09-22T00:00:00.000Z',
            folded_through_key: 'room-1:40:commit',
          },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json([
          { hand_key: 'room-1:41:commit', observed_at: '2026-09-22T00:00:00.000Z', evidence },
        ]),
      )
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    const state = await store.load('albie', PLAYER_ID)
    expect(state?.weightedHands).toBe(41)
    expect(state?.weightedVpip).toBe(11)
    const [checkpointUrl] = request.mock.calls[0] ?? []
    expect(String(checkpointUrl)).toContain('bot_opponent_checkpoints')
    const [rowsUrl] = request.mock.calls[1] ?? []
    expect(decodeURIComponent(String(rowsUrl))).toContain(
      'or=(observed_at.gt."2026-09-22T00:00:00.000Z",and(observed_at.eq."2026-09-22T00:00:00.000Z",hand_key.gt."room-1:40:commit"))',
    )
  })

  it('rejects a malformed checkpoint instead of shaping a bot read from it', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json([
          { state: { version: 1 }, folded_through_at: '2026-09-22', folded_through_key: 'k' },
        ]),
      )
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(store.load('albie', PLAYER_ID)).rejects.toThrow('Invalid opponent checkpoint')
  })

  it('rejects malformed stored evidence instead of shaping a bot read from it', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json([{ hand_key: 'bad', observed_at: '2026-09-22', evidence: { vpip: true } }]),
      )
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(store.load('albie', PLAYER_ID)).rejects.toThrow('Invalid opponent evidence')
  })

  it('returns no read for a player with no stored hands', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json([]))
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(store.load('albie', PLAYER_ID)).resolves.toBeNull()
  })

  it('fails closed instead of silently discarding old evidence at the replay limit', async () => {
    const row = { hand_key: 'hand', observed_at: '2026-09-22', evidence }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(Array(2049).fill(row)))
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(store.load('albie', PLAYER_ID)).rejects.toThrow('replay limit exceeded')
  })

  it('round-trips bot-owned rows through the REST contract without duplicating a hand', async () => {
    const rows = new Map<string, Record<string, unknown>>()
    const request = vi.fn<typeof fetch>(async (target, init) => {
      if (init?.method === 'POST') {
        const row = JSON.parse(String(init.body)) as Record<string, unknown>
        const key = `${row.bot_id}:${row.player_id}:${row.model_version}:${row.hand_key}`
        if (!rows.has(key)) rows.set(key, row)
        return new Response(null, { status: 201 })
      }
      const query = new URL(String(target))
      if (query.pathname.endsWith('bot_opponent_checkpoints')) return Response.json([])
      const selected = [...rows.values()]
        .filter(
          (row) =>
            `eq.${row.bot_id}` === query.searchParams.get('bot_id') &&
            `eq.${row.player_id}` === query.searchParams.get('player_id') &&
            `eq.${row.model_version}` === query.searchParams.get('model_version'),
        )
        .map((row) => ({
          hand_key: row.hand_key,
          observed_at: row.observed_at,
          evidence: row.evidence,
        }))
      return Response.json(selected)
    })
    const store = new SupabaseBotOpponentStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    const observation = {
      botId: 'albie',
      playerId: PLAYER_ID,
      handKey: 'room-1:12:commit',
      observedAtMs: Date.UTC(2026, 8, 22),
      evidence,
    }
    await store.append(observation)
    await store.append(observation)
    expect(rows.size).toBe(1)
    expect((await store.load('albie', PLAYER_ID))?.weightedHands).toBe(1)
    await expect(store.load('bernadette', PLAYER_ID)).resolves.toBeNull()
  })
})
