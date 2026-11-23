import { serviceHeaders } from './supabase-rest.js'

export interface SupabaseInventoryOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}

/** One player-owned inventory table: rows of player, what is owned, its slot, and whether it is on. */
export interface InventoryTable {
  /** The REST table, e.g. `player_table_items`. */
  readonly table: string
  /** The column naming what is owned, e.g. `item_id`. */
  readonly idColumn: string
  /** What one row is called in errors, e.g. `table item`. */
  readonly noun: string
  /** The error for turning on something the player does not own. */
  readonly notOwned: string
}

export interface InventoryRow {
  id: string
  slot: string
  equipped: boolean
}

/**
 * Inventory reads and writes against Supabase REST.
 *
 * Writes go through the service role because the tables deny insert and update
 * to anon and authenticated: a client that could write here would grant itself
 * what it never paid for.
 */
export class SupabaseInventory {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly shape: InventoryTable

  constructor(options: SupabaseInventoryOptions, shape: InventoryTable) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.shape = shape
  }

  async list(playerId: string): Promise<InventoryRow[]> {
    const query = new URL(this.url())
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('select', `${this.shape.idColumn},slot,equipped`)
    const response = await this.request(query, { headers: serviceHeaders(this.serviceRoleKey) })
    const body = await this.read(response)
    if (!Array.isArray(body)) throw new Error('Supabase returned an invalid inventory response')
    return body.map((row) => this.asRow(row))
  }

  async add(playerId: string, id: string, slot: string): Promise<void> {
    const response = await this.request(this.url(), {
      method: 'POST',
      headers: {
        ...serviceHeaders(this.serviceRoleKey),
        prefer: 'return=minimal,resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        player_id: playerId,
        [this.shape.idColumn]: id,
        slot,
        equipped: false,
      }),
    })
    await this.read(response)
  }

  /**
   * Turning something on clears its slot first.
   *
   * Each table carries a partial unique index on (player_id, slot) where
   * equipped, so setting a second row without clearing the first is rejected by
   * the database rather than doubling what the slot gives. This clears then sets
   * so the ordinary path does not rely on hitting that error.
   */
  async setEquipped(playerId: string, id: string, equipped: boolean): Promise<void> {
    if (equipped) {
      const owned = await this.list(playerId)
      const target = owned.find((entry) => entry.id === id)
      if (target === undefined) throw new Error(this.shape.notOwned)
      const occupying = owned.find(
        (entry) => entry.slot === target.slot && entry.equipped && entry.id !== id,
      )
      if (occupying !== undefined) await this.setEquippedRow(playerId, occupying.id, false)
    }
    await this.setEquippedRow(playerId, id, equipped)
  }

  private async setEquippedRow(playerId: string, id: string, equipped: boolean): Promise<void> {
    const query = new URL(this.url())
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set(this.shape.idColumn, `eq.${id}`)
    const response = await this.request(query, {
      method: 'PATCH',
      headers: { ...serviceHeaders(this.serviceRoleKey), prefer: 'return=minimal' },
      body: JSON.stringify({ equipped }),
    })
    await this.read(response)
  }

  private url(): string {
    return `${this.baseUrl}/rest/v1/${this.shape.table}`
  }

  private asRow(row: unknown): InventoryRow {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`Supabase returned an invalid ${this.shape.noun} row`)
    }
    const record = row as Record<string, unknown>
    const id = record[this.shape.idColumn]
    const slot = record.slot
    if (typeof id !== 'string' || typeof slot !== 'string') {
      throw new Error(`Supabase returned a ${this.shape.noun} row without an id or slot`)
    }
    return { id, slot, equipped: record.equipped === true }
  }

  private async read(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new Error(`Supabase ${this.shape.noun} request failed with ${response.status}`)
    }
    const text = await response.text()
    if (text.length === 0) return null
    return JSON.parse(text) as unknown
  }
}
