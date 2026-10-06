import { type Cosmetic, cosmeticCatalogue } from '@river/engine'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buyCosmetic,
  type CosmeticStore,
  type OwnedCosmetic,
  wearCosmetic,
} from './cosmetic-service.js'
import type { Ledger } from './ledger.js'

const catalogue = cosmeticCatalogue()
const cheapest = [...catalogue].sort((a, b) => a.priceChips - b.priceChips)[0]
if (cheapest === undefined) throw new Error('the cosmetic catalogue is empty')
const cheap: Cosmetic = cheapest

class FakeStore implements CosmeticStore {
  rows: OwnedCosmetic[] = []
  async list(): Promise<OwnedCosmetic[]> {
    return [...this.rows]
  }
  async add(_playerId: string, cosmetic: Cosmetic): Promise<void> {
    this.rows.push({ cosmeticId: cosmetic.id, slot: cosmetic.slot, equipped: false })
  }
  async setWorn(_playerId: string, cosmeticId: string, worn: boolean): Promise<void> {
    const row = this.rows.find((one) => one.cosmeticId === cosmeticId)
    if (row !== undefined) row.equipped = worn
  }
}

class FakeLedger implements Ledger {
  entries: { delta: number; ref: string; reason: string }[] = []
  constructor(private current: number) {}
  async balance(): Promise<number> {
    return this.current
  }
  async apply(entry: { delta: number; ref: string; reason: string }): Promise<number> {
    if (this.entries.some((one) => one.ref === entry.ref)) return this.current
    this.entries.push({ delta: entry.delta, ref: entry.ref, reason: entry.reason })
    this.current += entry.delta
    return this.current
  }
}

let store: FakeStore
beforeEach(() => {
  store = new FakeStore()
})

describe('cosmetics', () => {
  it('buys a cosmetic the player can afford', async () => {
    const ledger = new FakeLedger(10_000_000)
    await expect(buyCosmetic('alice', cheap.id, { ledger, store })).resolves.toMatchObject({
      kind: 'purchased',
    })
    expect(ledger.entries[0]?.delta).toBe(-cheap.priceChips)
  })

  it('refuses and writes nothing when the player cannot afford it', async () => {
    const ledger = new FakeLedger(0)
    await expect(buyCosmetic('alice', cheap.id, { ledger, store })).resolves.toMatchObject({
      reason: 'insufficient-chips',
    })
    expect(ledger.entries).toHaveLength(0)
  })

  it('never debits twice for the same cosmetic', async () => {
    const ledger = new FakeLedger(10_000_000)
    await buyCosmetic('alice', cheap.id, { ledger, store })
    await expect(buyCosmetic('alice', cheap.id, { ledger, store })).resolves.toMatchObject({
      reason: 'already-owned',
    })
    expect(ledger.entries).toHaveLength(1)
  })

  it('uses a ref that is stable per player and cosmetic', async () => {
    const ledger = new FakeLedger(10_000_000)
    await buyCosmetic('alice', cheap.id, { ledger, store })
    expect(ledger.entries[0]?.ref).toBe(`cosmetic:alice:${cheap.id}`)
  })

  it('books the spend under its own reason, distinct from table items', async () => {
    const ledger = new FakeLedger(10_000_000)
    await buyCosmetic('alice', cheap.id, { ledger, store })
    expect(ledger.entries[0]?.reason).toBe('cosmetic')
  })

  it('refuses an unknown cosmetic rather than charging for nothing', async () => {
    const ledger = new FakeLedger(10_000_000)
    await expect(buyCosmetic('alice', 'not-real', { ledger, store })).resolves.toMatchObject({
      reason: 'unknown',
    })
    expect(ledger.entries).toHaveLength(0)
  })

  it('wears an owned cosmetic', async () => {
    const ledger = new FakeLedger(10_000_000)
    await buyCosmetic('alice', cheap.id, { ledger, store })
    await expect(wearCosmetic('alice', cheap.id, { store })).resolves.toMatchObject({
      kind: 'worn',
    })
  })

  it('refuses to wear something the player does not own', async () => {
    await expect(wearCosmetic('alice', cheap.id, { store })).resolves.toMatchObject({
      reason: 'not-owned',
    })
  })

  it('only ever debits chips, never credits them', async () => {
    const ledger = new FakeLedger(50_000_000)
    for (const cosmetic of catalogue.slice(0, 6)) {
      await buyCosmetic('alice', cosmetic.id, { ledger, store })
    }
    expect(ledger.entries.every((entry) => entry.delta < 0)).toBe(true)
  })
})
