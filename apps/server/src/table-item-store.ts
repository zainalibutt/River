import type { TableItem } from '@river/engine'
import { SupabaseInventory, type SupabaseInventoryOptions } from './supabase-inventory.js'
import type { OwnedItem, TableItemStore } from './table-item-service.js'

export type SupabaseTableItemStoreOptions = SupabaseInventoryOptions

/**
 * Table items against Supabase REST. A client that could write this table
 * would grant itself a REP boost without paying for it, and a second item
 * equipped in one slot would silently double the player's REP rate.
 */
export class SupabaseTableItemStore implements TableItemStore {
  private readonly inventory: SupabaseInventory

  constructor(options: SupabaseTableItemStoreOptions) {
    this.inventory = new SupabaseInventory(options, {
      table: 'player_table_items',
      idColumn: 'item_id',
      noun: 'table item',
      notOwned: 'cannot equip an item the player does not own',
    })
  }

  async list(playerId: string): Promise<OwnedItem[]> {
    const rows = await this.inventory.list(playerId)
    return rows.map(({ id, slot, equipped }) => ({ itemId: id, slot, equipped }))
  }

  add(playerId: string, item: TableItem): Promise<void> {
    return this.inventory.add(playerId, item.id, item.slot)
  }

  setEquipped(playerId: string, itemId: string, equipped: boolean): Promise<void> {
    return this.inventory.setEquipped(playerId, itemId, equipped)
  }
}
