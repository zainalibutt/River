import type { Cosmetic } from '@river/engine'
import type { CosmeticStore, OwnedCosmetic } from './cosmetic-service.js'

export interface SupabaseCosmeticStoreOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
}

function asOwnedCosmetic(row: unknown): OwnedCosmetic {
  if (typeof row !== 'object' || row === null) {
    throw new Error('Supabase returned an invalid cosmetic row')
  }
  const record = row as Record<string, unknown>
  const cosmeticId = record.cosmetic_id
  const slot = record.slot
  if (typeof cosmeticId !== 'string' || typeof slot !== 'string') {
    throw new Error('Supabase returned a cosmetic row without an id or slot')
  }
  return { cosmeticId, slot, equipped: record.equipped === true }
}

/**
 * Wardrobe reads and writes against Supabase REST, matching SupabaseTableItemStore.
 *
 * Writes go through the service role because the table denies insert and update
 * to anon and authenticated: a client that could write here would grant itself
 * a wardrobe without paying for it.
 */
export class SupabaseCosmeticStore implements CosmeticStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch

  constructor(options: SupabaseCosmeticStoreOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
  }

  async list(playerId: string): Promise<OwnedCosmetic[]> {
    const query = new URL(`${this.baseUrl}/rest/v1/player_cosmetics`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('select', 'cosmetic_id,slot,equipped')
    const response = await this.request(query, { headers: this.headers() })
    const body = await this.read(response)
    if (!Array.isArray(body)) throw new Error('Supabase returned an invalid inventory response')
    return body.map(asOwnedCosmetic)
  }

  async add(playerId: string, cosmetic: Cosmetic): Promise<void> {
    const response = await this.request(`${this.baseUrl}/rest/v1/player_cosmetics`, {
      method: 'POST',
      headers: { ...this.headers(), prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify({
        player_id: playerId,
        cosmetic_id: cosmetic.id,
        slot: cosmetic.slot,
        equipped: false,
      }),
    })
    await this.read(response)
  }

  /**
   * Wearing clears the slot first.
   *
   * The table carries a partial unique index on (player_id, slot) where
   * equipped, so setting a second cosmetic without clearing the first is
   * rejected by the database rather than rendering a character wearing both.
   * Clearing first keeps the ordinary path off that error.
   */
  async setWorn(playerId: string, cosmeticId: string, worn: boolean): Promise<void> {
    if (worn) {
      const owned = await this.list(playerId)
      const target = owned.find((entry) => entry.cosmeticId === cosmeticId)
      if (target === undefined) throw new Error('cannot wear a cosmetic the player does not own')
      const occupying = owned.find(
        (entry) => entry.slot === target.slot && entry.equipped && entry.cosmeticId !== cosmeticId,
      )
      if (occupying !== undefined) await this.setWornRow(playerId, occupying.cosmeticId, false)
    }
    await this.setWornRow(playerId, cosmeticId, worn)
  }

  private async setWornRow(playerId: string, cosmeticId: string, worn: boolean): Promise<void> {
    const query = new URL(`${this.baseUrl}/rest/v1/player_cosmetics`)
    query.searchParams.set('player_id', `eq.${playerId}`)
    query.searchParams.set('cosmetic_id', `eq.${cosmeticId}`)
    const response = await this.request(query, {
      method: 'PATCH',
      headers: { ...this.headers(), prefer: 'return=minimal' },
      body: JSON.stringify({ equipped: worn }),
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
      throw new Error(`Supabase cosmetic request failed with ${response.status}`)
    }
    const text = await response.text()
    if (text.length === 0) return null
    return JSON.parse(text) as unknown
  }
}
