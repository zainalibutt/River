import type { Cosmetic } from '@river/engine'
import type { CosmeticStore, OwnedCosmetic } from './cosmetic-service.js'
import { SupabaseInventory, type SupabaseInventoryOptions } from './supabase-inventory.js'

export type SupabaseCosmeticStoreOptions = SupabaseInventoryOptions

/**
 * The wardrobe against Supabase REST. A client that could write this table
 * would grant itself a wardrobe without paying for it, and a second cosmetic
 * worn in one slot would render a character wearing both.
 */
export class SupabaseCosmeticStore implements CosmeticStore {
  private readonly inventory: SupabaseInventory

  constructor(options: SupabaseCosmeticStoreOptions) {
    this.inventory = new SupabaseInventory(options, {
      table: 'player_cosmetics',
      idColumn: 'cosmetic_id',
      noun: 'cosmetic',
      notOwned: 'cannot wear a cosmetic the player does not own',
    })
  }

  async list(playerId: string): Promise<OwnedCosmetic[]> {
    const rows = await this.inventory.list(playerId)
    return rows.map(({ id, slot, equipped }) => ({ cosmeticId: id, slot, equipped }))
  }

  add(playerId: string, cosmetic: Cosmetic): Promise<void> {
    return this.inventory.add(playerId, cosmetic.id, cosmetic.slot)
  }

  setWorn(playerId: string, cosmeticId: string, worn: boolean): Promise<void> {
    return this.inventory.setEquipped(playerId, cosmeticId, worn)
  }
}
