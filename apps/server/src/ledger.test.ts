import { describe, expect, it, vi } from 'vitest'
import { SupabaseLedger } from './ledger.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Supabase ledger adapter', () => {
  it('reads a player balance with server-only credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response([{ balance: '100000' }]))
    const ledger = new SupabaseLedger({
      supabaseUrl: 'https://river.supabase.co/',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(ledger.balance(PLAYER_ID)).resolves.toBe(100_000)
    const [url, init] = request.mock.calls[0] ?? []
    expect(String(url)).toContain(`player_id=eq.${PLAYER_ID}`)
    expect(init?.headers).toMatchObject({
      apikey: 'server-secret',
      authorization: 'Bearer server-secret',
    })
  })

  it('applies an idempotent ledger entry through the atomic RPC', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response(50_000))
    const ledger = new SupabaseLedger({
      supabaseUrl: 'https://river.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(
      ledger.apply({
        playerId: PLAYER_ID,
        delta: -50_000,
        reason: 'table_buy_in',
        ref: 'room-a:sit:request-1',
      }),
    ).resolves.toBe(50_000)
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      p_player_id: PLAYER_ID,
      p_delta: -50_000,
      p_reason: 'table_buy_in',
      p_ref: 'room-a:sit:request-1',
    })
  })

  it('surfaces database rejection without exposing credentials', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ message: 'insufficient balance' }, 400))
    const ledger = new SupabaseLedger({
      supabaseUrl: 'https://river.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: request,
    })
    await expect(
      ledger.apply({ playerId: PLAYER_ID, delta: -1, reason: 'table_buy_in', ref: 'request-2' }),
    ).rejects.toThrow('insufficient balance')
  })

  it('gives up on a Supabase call that never answers', async () => {
    const ledger = new SupabaseLedger({
      supabaseUrl: 'https://river.test',
      serviceRoleKey: 'service-role',
      timeoutMs: 20,
      fetch: (_target, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'TimeoutError'
            reject(error)
          })
        }),
    })
    await expect(ledger.balance(PLAYER_ID)).rejects.toThrow('did not answer within 20ms')
  })

  describe('the book of open seatings', () => {
    const seating = {
      playerId: PLAYER_ID,
      ref: 'river-one:sit-1',
      buyIn: 70_000,
      openedAtMs: Date.UTC(2026, 8, 29, 12),
    }

    function recorder(respond: () => Response = () => new Response(null, { status: 201 })) {
      const calls: { url: string; init: RequestInit | undefined }[] = []
      const ledger = new SupabaseLedger({
        supabaseUrl: 'https://river.test/',
        serviceRoleKey: 'service-role',
        fetch: async (target, init) => {
          calls.push({ url: String(target), init })
          return respond()
        },
      })
      return { ledger, calls }
    }

    it('writes a seating that opens, or grows, as one row per player and seating', async () => {
      const { ledger, calls } = recorder()
      await ledger.open(seating)
      expect(calls[0]?.url).toBe('https://river.test/rest/v1/table_seatings')
      expect(calls[0]?.init?.method).toBe('POST')
      expect(calls[0]?.init?.headers).toMatchObject({
        apikey: 'service-role',
        prefer: 'return=minimal,resolution=merge-duplicates',
      })
      // No closed_at: writing an open seating again can never reopen a closed one.
      expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
        player_id: PLAYER_ID,
        ref: 'river-one:sit-1',
        buy_in: 70_000,
        opened_at: '2026-09-29T12:00:00.000Z',
      })
    })

    it('closes a seating by writing the whole row with when it closed', async () => {
      const { ledger, calls } = recorder()
      await ledger.close(seating)
      expect(calls[0]?.init?.headers).toMatchObject({
        prefer: 'return=minimal,resolution=merge-duplicates',
      })
      const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({ player_id: PLAYER_ID, ref: 'river-one:sit-1', buy_in: 70_000 })
      expect(typeof body.closed_at).toBe('string')
    })

    it('reads the seatings opened before a moment that never closed', async () => {
      const { ledger, calls } = recorder(
        () =>
          new Response(
            JSON.stringify([
              {
                player_id: PLAYER_ID,
                ref: 'river-one:sit-1',
                buy_in: '70000',
                opened_at: '2026-09-29T12:00:00+00:00',
              },
            ]),
            { status: 200 },
          ),
      )
      await expect(ledger.unsettled(Date.UTC(2026, 8, 29, 13))).resolves.toEqual([seating])
      const url = new URL(calls[0]?.url ?? '')
      expect(url.pathname).toBe('/rest/v1/table_seatings')
      expect(url.searchParams.get('closed_at')).toBe('is.null')
      expect(url.searchParams.get('opened_at')).toBe('lt.2026-09-29T13:00:00.000Z')
      expect(url.searchParams.get('select')).toBe('player_id,ref,buy_in,opened_at')
    })

    it('turns the page when a page comes back full', async () => {
      const row = (index: number) => ({
        player_id: PLAYER_ID,
        ref: `river-one:sit-${index}`,
        buy_in: 50_000,
        opened_at: '2026-09-29T12:00:00Z',
      })
      const pages = [Array.from({ length: 500 }, (_, index) => row(index)), [row(500)]]
      const { ledger, calls } = recorder(
        () => new Response(JSON.stringify(pages.shift() ?? []), { status: 200 }),
      )
      await expect(ledger.unsettled(Date.UTC(2026, 8, 29, 13))).resolves.toHaveLength(501)
      expect(calls.map((call) => new URL(call.url).searchParams.get('offset'))).toEqual([
        '0',
        '500',
      ])
    })

    it('refuses a row it cannot read rather than refunding a guess', async () => {
      const { ledger } = recorder(
        () => new Response(JSON.stringify([{ player_id: PLAYER_ID, ref: 'x', buy_in: -1 }])),
      )
      await expect(ledger.unsettled(Date.UTC(2026, 8, 29, 13))).rejects.toThrow(
        'invalid seating row',
      )
    })

    it('surfaces a failed write', async () => {
      const { ledger } = recorder(
        () => new Response(JSON.stringify({ message: 'relation does not exist' }), { status: 404 }),
      )
      await expect(ledger.close(seating)).rejects.toThrow('relation does not exist')
    })
  })

  it('carries a deadline on every request it makes', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const ledger = new SupabaseLedger({
      supabaseUrl: 'https://river.test',
      serviceRoleKey: 'service-role',
      fetch: async (_target, init) => {
        signals.push(init?.signal)
        return new Response(JSON.stringify(2_500), { status: 200 })
      },
    })
    await ledger.apply({ playerId: PLAYER_ID, delta: 100, reason: 'test', ref: 'ref-1' })
    expect(signals.length).toBe(1)
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })
})
