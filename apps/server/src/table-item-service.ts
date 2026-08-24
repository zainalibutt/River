import { canEquip, itemCatalogue, type TableItem } from '@river/engine'
import type { Ledger } from './ledger.js'

export interface OwnedItem {
  itemId: string
  slot: string
  equipped: boolean
}

export type PurchaseOutcome =
  | { kind: 'purchased'; itemId: string; balance: number }
  | { kind: 'refused'; reason: 'unknown-item' | 'already-owned' | 'insufficient-chips' }

export type EquipOutcome =
  | { kind: 'equipped'; itemId: string }
  | { kind: 'refused'; reason: 'not-owned' | 'slot-taken' }

export interface TableItemStore {
  list(playerId: string): Promise<OwnedItem[]>
  add(playerId: string, item: TableItem): Promise<void>
  setEquipped(playerId: string, itemId: string, equipped: boolean): Promise<void>
}

export function itemById(itemId: string): TableItem | undefined {
  return itemCatalogue().find((item) => item.id === itemId)
}

export function ownedItems(
  catalogue: readonly TableItem[],
  owned: readonly OwnedItem[],
): TableItem[] {
  const byId = new Map(catalogue.map((item) => [item.id, item]))
  return owned.flatMap((entry) => {
    const item = byId.get(entry.itemId)
    return item === undefined ? [] : [item]
  })
}

export function equippedItems(
  catalogue: readonly TableItem[],
  owned: readonly OwnedItem[],
): TableItem[] {
  return ownedItems(
    catalogue,
    owned.filter((entry) => entry.equipped),
  )
}

/**
 * Buy an item with chips.
 *
 * The ledger ref is deterministic per player and item, so a replayed purchase
 * hits the unique index and debits nothing. This is the guard rather than a
 * check-then-write, which would race a double click into two debits.
 */
export async function purchaseItem(
  playerId: string,
  itemId: string,
  deps: { ledger: Ledger; store: TableItemStore },
): Promise<PurchaseOutcome> {
  const item = itemById(itemId)
  if (item === undefined) return { kind: 'refused', reason: 'unknown-item' }

  const owned = await deps.store.list(playerId)
  if (owned.some((entry) => entry.itemId === itemId)) {
    return { kind: 'refused', reason: 'already-owned' }
  }

  const balance = await deps.ledger.balance(playerId)
  if (balance < item.priceChips) return { kind: 'refused', reason: 'insufficient-chips' }

  const next = await deps.ledger.apply({
    playerId,
    delta: -item.priceChips,
    reason: 'table_item',
    ref: `item:${playerId}:${itemId}`,
  })
  await deps.store.add(playerId, item)
  return { kind: 'purchased', itemId, balance: next }
}

/**
 * Equip an owned item. Free and reversible - only the purchase moves chips.
 */
export async function equipItem(
  playerId: string,
  itemId: string,
  deps: { store: TableItemStore },
): Promise<EquipOutcome> {
  const item = itemById(itemId)
  if (item === undefined) return { kind: 'refused', reason: 'not-owned' }

  const owned = await deps.store.list(playerId)
  if (!owned.some((entry) => entry.itemId === itemId)) {
    return { kind: 'refused', reason: 'not-owned' }
  }

  const equipped = equippedItems(itemCatalogue(), owned).filter((one) => one.id !== itemId)
  if (!canEquip(equipped, item)) return { kind: 'refused', reason: 'slot-taken' }

  await deps.store.setEquipped(playerId, itemId, true)
  return { kind: 'equipped', itemId }
}
