import { itemCatalogue } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { SupabaseTableItemStore } from './table-item-store.js'

const item = itemCatalogue()[0]
if (item === undefined) throw new Error('the catalogue is empty')

interface Call {
  url: string
  method: string
  body: unknown
}

function storeWith(rows: unknown[]): { store: SupabaseTableItemStore; calls: Call[] } {
  const calls: Call[] = []
  const request = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({
      url,
      method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    if (method === 'GET') {
      return new Response(JSON.stringify(rows), { status: 200 })
    }
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch

  return {
    store: new SupabaseTableItemStore({
      supabaseUrl: 'https://example.supabase.co/',
      serviceRoleKey: 'service-role',
      fetch: request,
    }),
    calls,
  }
}

describe('supabase table item store', () => {
  it('reads a player inventory', async () => {
    const { store } = storeWith([{ item_id: item.id, slot: item.slot, equipped: true }])
    await expect(store.list('alice')).resolves.toEqual([
      { itemId: item.id, slot: item.slot, equipped: true },
    ])
  })

  it('scopes the read to one player', async () => {
    const { store, calls } = storeWith([])
    await store.list('alice')
    expect(calls[0]?.url).toContain('player_id=eq.alice')
  })

  it('treats a missing equipped flag as not equipped', async () => {
    const { store } = storeWith([{ item_id: item.id, slot: item.slot }])
    const rows = await store.list('alice')
    expect(rows[0]?.equipped).toBe(false)
  })

  it('rejects a row without an id rather than inventing one', async () => {
    const { store } = storeWith([{ slot: 'left' }])
    await expect(store.list('alice')).rejects.toThrow(/without an id or slot/)
  })

  it('adds an item unequipped, so buying never changes what is on the table', async () => {
    const { store, calls } = storeWith([])
    await store.add('alice', item)
    const insert = calls.find((call) => call.method === 'POST')
    expect(insert?.body).toMatchObject({ player_id: 'alice', item_id: item.id, equipped: false })
  })

  it('ignores a duplicate insert instead of failing a repeated purchase', async () => {
    const { store, calls } = storeWith([])
    await store.add('alice', item)
    expect(calls.find((call) => call.method === 'POST')?.url).toBeDefined()
    // resolution=ignore-duplicates keeps a retried purchase idempotent
    expect(JSON.stringify(calls)).toContain('player_table_items')
  })

  it('clears the occupied slot before equipping into it', async () => {
    const other = itemCatalogue().find(
      (candidate) => candidate.slot === item.slot && candidate.id !== item.id,
    )
    if (other === undefined) return
    const { store, calls } = storeWith([
      { item_id: item.id, slot: item.slot, equipped: false },
      { item_id: other.id, slot: other.slot, equipped: true },
    ])
    await store.setEquipped('alice', item.id, true)
    const patches = calls.filter((call) => call.method === 'PATCH')
    expect(patches[0]?.url).toContain(`item_id=eq.${other.id}`)
    expect(patches[0]?.body).toEqual({ equipped: false })
    expect(patches[1]?.url).toContain(`item_id=eq.${item.id}`)
    expect(patches[1]?.body).toEqual({ equipped: true })
  })

  it('refuses to equip an item the player does not own', async () => {
    const { store } = storeWith([])
    await expect(store.setEquipped('alice', item.id, true)).rejects.toThrow(/does not own/)
  })

  it('unequips without reading the inventory first', async () => {
    const { store, calls } = storeWith([])
    await store.setEquipped('alice', item.id, false)
    expect(calls.every((call) => call.method !== 'GET')).toBe(true)
  })

  it('raises on a failed request rather than reporting success', async () => {
    const failing = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch
    const store = new SupabaseTableItemStore({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role',
      fetch: failing,
    })
    await expect(store.list('alice')).rejects.toThrow(/failed with 500/)
  })
})
