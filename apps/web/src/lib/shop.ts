import type { TableItem } from '@river/engine'

export interface OwnedEntry {
  itemId: string
  slot: string
  equipped: boolean
}

export type ShopState = 'buyable' | 'unaffordable' | 'owned' | 'equipped'

export interface ShopRow {
  item: TableItem
  state: ShopState
  /** Chips still needed. Zero unless the row is unaffordable. */
  shortfall: number
}

/**
 * What a player can do with one item right now.
 *
 * Ownership outranks price: an item already bought is never shown as
 * unaffordable just because the player has since spent down, which would read
 * as the game taking something back.
 */
export function shopStateFor(
  item: TableItem,
  owned: readonly OwnedEntry[],
  balance: number,
): ShopState {
  const entry = owned.find((one) => one.itemId === item.id)
  if (entry !== undefined) return entry.equipped ? 'equipped' : 'owned'
  return balance >= item.priceChips ? 'buyable' : 'unaffordable'
}

export function shopRows(
  catalogue: readonly TableItem[],
  owned: readonly OwnedEntry[],
  balance: number,
): ShopRow[] {
  return catalogue.map((item) => {
    const state = shopStateFor(item, owned, balance)
    return {
      item,
      state,
      shortfall: state === 'unaffordable' ? item.priceChips - balance : 0,
    }
  })
}

/**
 * Equipping is free, so an owned item is always actionable. Buying is only
 * offered when the chips are actually there - a button that fails on click
 * teaches a player to distrust the whole screen.
 */
export function isActionable(state: ShopState): boolean {
  return state === 'buyable' || state === 'owned'
}

export function actionLabel(state: ShopState): string {
  switch (state) {
    case 'buyable':
      return 'BUY'
    case 'owned':
      return 'EQUIP'
    case 'equipped':
      return 'EQUIPPED'
    default:
      return 'LOCKED'
  }
}

/** Total REP rate from equipped items, as an additive percentage. */
export function equippedRatePercent(
  catalogue: readonly TableItem[],
  owned: readonly OwnedEntry[],
): number {
  const byId = new Map(catalogue.map((item) => [item.id, item]))
  const total = owned
    .filter((entry) => entry.equipped)
    .reduce((sum, entry) => sum + (byId.get(entry.itemId)?.repModifier ?? 0), 0)
  return Math.round((1 + total) * 100)
}
