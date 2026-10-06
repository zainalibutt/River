import type { TableItem } from '@river/engine'
import type { OwnedItem, TableItemStore } from './table-item-service.js'

export interface SupabaseTableItemStoreOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}

function asOwnedItem(row: unknown): OwnedItem {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Supabase returned an invalid table item row')
  }
  const record = row as Record<string, unknown>
  const itemId = record.item_id
  const slot = record.slot
  if (typeof itemId !== 'string' || typeof slot !== 'string') {
    throw new Error('Supabase returned a table item row without an id or slot')
  }
  return { itemId, slot, equipped: record.equipped === true }
}

/**
 * Inventory reads and writes against Supabase REST, matching SupabaseLedger.
 *
 * Writes go through the service role because the table denies insert and update
 * to anon and authenticated: a client that could write here would grant itself
 * a REP boost without paying for it.
 */
export class SupabaseTableItemStore implements TableItemStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch

  constructor(options: SupabaseTableItemStoreOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
  }

  async list(playerId: string): Promise<OwnedItem[]> {
    const query = new URL(`${this.baseUrl}/rest/v1/player_table_items`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('select', 'item_id,slot,equipped')
    const response = await this.request(query, { headers: this.headers() })
    const body = await this.read(response)
    if (!Array.isArray(body)) throw new Error('Supabase returned an invalid inventory response')
    return body.map(asOwnedItem)
  }

  async add(playerId: string, item: TableItem): Promise<void> {
    const response = await this.request(`${this.baseUrl}/rest/v1/player_table_items`, {
      method: 'POST',
      headers: { ...this.headers(), prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify({
        player_id: playerId,
        item_id: item.id,
        slot: item.slot,
        equipped: false,
      }),
    })
    await this.read(response)
  }

  /**
   * Equipping clears the slot first.
   *
   * The table carries a partial unique index on (player_id, slot) where
   * equipped, so setting a second item without clearing the first is rejected
   * by the database rather than silently doubling the player's REP rate. This
   * clears then sets so the ordinary path does not rely on hitting that error.
   */
  async setEquipped(playerId: string, itemId: string, equipped: boolean): Promise<void> {
    if (equipped) {
      const owned = await this.list(playerId)
      const target = owned.find((entry) => entry.itemId === itemId)
      if (target === undefined) throw new Error('cannot equip an item the player does not own')
      const occupying = owned.find(
        (entry) => entry.slot === target.slot && entry.equipped && entry.itemId !== itemId,
      )
      if (occupying !== undefined) await this.setEquippedRow(playerId, occupying.itemId, false)
    }
    await this.setEquippedRow(playerId, itemId, equipped)
  }

  private async setEquippedRow(playerId: string, itemId: string, equipped: boolean): Promise<void> {
    const query = new URL(`${this.baseUrl}/rest/v1/player_table_items`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('item_id', `eq.${itemId}`)
    const response = await this.request(query, {
      method: 'PATCH',
      headers: { ...this.headers(), prefer: 'return=minimal' },
      body: JSON.stringify({ equipped }),
    })
    await this.read(response)
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.serviceRoleKey,
      authorization: `Bearer ${this.serviceRoleKey}`,
      'content-type': 'application/json',
    }
  }

  private async read(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new Error(`Supabase table item request failed with ${response.status}`)
    }
    const text = await response.text()
    if (text.length === 0) return null
    return JSON.parse(text) as unknown
  }
}
