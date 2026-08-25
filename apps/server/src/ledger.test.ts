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
