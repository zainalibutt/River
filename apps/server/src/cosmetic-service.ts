import { type Cosmetic, cosmeticCatalogue } from '@river/engine'
import { isInsufficientBalance, type Ledger } from './ledger.js'

export interface OwnedCosmetic {
  cosmeticId: string
  slot: string
  equipped: boolean
}

export type CosmeticOutcome =
  | { kind: 'purchased'; cosmeticId: string; balance: number }
  | { kind: 'worn'; cosmeticId: string }
  | { kind: 'refused'; reason: 'unknown' | 'already-owned' | 'insufficient-chips' | 'not-owned' }

export interface CosmeticStore {
  list(playerId: string): Promise<OwnedCosmetic[]>
  add(playerId: string, cosmetic: Cosmetic): Promise<void>
  setWorn(playerId: string, cosmeticId: string, worn: boolean): Promise<void>
}

export function cosmeticById(cosmeticId: string): Cosmetic | undefined {
  return cosmeticCatalogue().find((item) => item.id === cosmeticId)
}

/**
 * Buy a cosmetic with chips.
 *
 * Identical guarantees to a table item purchase: the ledger ref is
 * deterministic per player and cosmetic, so a double click debits once, and
 * buying again after a charge whose cosmetic never landed debits nothing and
 * delivers it. The ledger checks the balance.
 */
export async function buyCosmetic(
  playerId: string,
  cosmeticId: string,
  deps: { ledger: Ledger; store: CosmeticStore },
): Promise<CosmeticOutcome> {
  const cosmetic = cosmeticById(cosmeticId)
  if (cosmetic === undefined) return { kind: 'refused', reason: 'unknown' }

  const owned = await deps.store.list(playerId)
  if (owned.some((entry) => entry.cosmeticId === cosmeticId)) {
    return { kind: 'refused', reason: 'already-owned' }
  }

  let next: number
  try {
    next = await deps.ledger.apply({
      playerId,
      delta: -cosmetic.priceChips,
      reason: 'cosmetic',
      ref: `cosmetic:${playerId}:${cosmeticId}`,
    })
  } catch (error) {
    if (isInsufficientBalance(error)) return { kind: 'refused', reason: 'insufficient-chips' }
    throw error
  }
  await deps.store.add(playerId, cosmetic)
  return { kind: 'purchased', cosmeticId, balance: next }
}

/** Wearing is free and reversible. Only the purchase moves chips. */
export async function wearCosmetic(
  playerId: string,
  cosmeticId: string,
  deps: { store: CosmeticStore },
): Promise<CosmeticOutcome> {
  if (cosmeticById(cosmeticId) === undefined) return { kind: 'refused', reason: 'unknown' }
  const owned = await deps.store.list(playerId)
  if (!owned.some((entry) => entry.cosmeticId === cosmeticId)) {
    return { kind: 'refused', reason: 'not-owned' }
  }
  await deps.store.setWorn(playerId, cosmeticId, true)
  return { kind: 'worn', cosmeticId }
}
