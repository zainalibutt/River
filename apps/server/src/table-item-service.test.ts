import { itemCatalogue } from '@river/engine'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Ledger } from './ledger.js'
import {
  equipItem,
  equippedItems,
  type OwnedItem,
  purchaseItem,
  type TableItemStore,
} from './table-item-service.js'

const catalogue = itemCatalogue()
const cheapest = [...catalogue].sort((a, b) => a.priceChips - b.priceChips)[0]
const other = catalogue.find((item) => item.id !== cheapest?.id && item.slot === cheapest?.slot)
const differentSlot = catalogue.find((item) => item.slot !== cheapest?.slot)

class FakeStore implements TableItemStore {
  rows: OwnedItem[] = []
  async list(): Promise<OwnedItem[]> {
    return [...this.rows]
  }
  async add(_playerId: string, item: { id: string; slot: string }): Promise<void> {
    this.rows.push({ itemId: item.id, slot: item.slot, equipped: false })
  }
  async setEquipped(_playerId: string, itemId: string, equipped: boolean): Promise<void> {
    const row = this.rows.find((one) => one.itemId === itemId)
    if (row !== undefined) row.equipped = equipped
  }
}

class FakeLedger implements Ledger {
  entries: { delta: number; ref: string }[] = []
  constructor(private current: number) {}
  async balance(): Promise<number> {
    return this.current
  }
  async apply(entry: { delta: number; ref: string }): Promise<number> {
    if (this.entries.some((one) => one.ref === entry.ref)) return this.current
    this.entries.push({ delta: entry.delta, ref: entry.ref })
    this.current += entry.delta
    return this.current
  }
}

let store: FakeStore

beforeEach(() => {
  store = new FakeStore()
})

describe('table items', () => {
  it('buys an item the player can afford', async () => {
    const ledger = new FakeLedger(1_000_000)
    const out = await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    expect(out.kind).toBe('purchased')
    expect(ledger.entries).toHaveLength(1)
    expect(ledger.entries[0]?.delta).toBe(-(cheapest?.priceChips ?? 0))
  })

  it('refuses an item the player cannot afford and writes nothing', async () => {
    const ledger = new FakeLedger(1)
    const out = await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    expect(out).toMatchObject({ kind: 'refused', reason: 'insufficient-chips' })
    expect(ledger.entries).toHaveLength(0)
  })

  it('refuses an unknown item rather than charging for nothing', async () => {
    const ledger = new FakeLedger(1_000_000)
    const out = await purchaseItem('alice', 'not-a-real-item', { ledger, store })
    expect(out).toMatchObject({ kind: 'refused', reason: 'unknown-item' })
    expect(ledger.entries).toHaveLength(0)
  })

  it('never debits twice for the same item', async () => {
    const ledger = new FakeLedger(1_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    const second = await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    expect(second).toMatchObject({ kind: 'refused', reason: 'already-owned' })
    expect(ledger.entries).toHaveLength(1)
  })

  it('uses a ref that is stable per player and item', async () => {
    const ledger = new FakeLedger(1_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    expect(ledger.entries[0]?.ref).toBe(`item:alice:${cheapest?.id}`)
  })

  it('equips an owned item', async () => {
    const ledger = new FakeLedger(1_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    await expect(equipItem('alice', cheapest?.id ?? '', { store })).resolves.toMatchObject({
      kind: 'equipped',
    })
  })

  it('refuses to equip something the player does not own', async () => {
    await expect(equipItem('alice', cheapest?.id ?? '', { store })).resolves.toMatchObject({
      kind: 'refused',
      reason: 'not-owned',
    })
  })

  it('refuses a second item in an occupied slot', async () => {
    if (other === undefined) return
    const ledger = new FakeLedger(10_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    await purchaseItem('alice', other.id, { ledger, store })
    await equipItem('alice', cheapest?.id ?? '', { store })
    await expect(equipItem('alice', other.id, { store })).resolves.toMatchObject({
      kind: 'refused',
      reason: 'slot-taken',
    })
  })

  it('allows items in different slots at once', async () => {
    if (differentSlot === undefined) return
    const ledger = new FakeLedger(10_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    await purchaseItem('alice', differentSlot.id, { ledger, store })
    await equipItem('alice', cheapest?.id ?? '', { store })
    await expect(equipItem('alice', differentSlot.id, { store })).resolves.toMatchObject({
      kind: 'equipped',
    })
  })

  it('reports only equipped items as equipped', async () => {
    const ledger = new FakeLedger(1_000_000)
    await purchaseItem('alice', cheapest?.id ?? '', { ledger, store })
    expect(equippedItems(catalogue, await store.list())).toHaveLength(0)
    await equipItem('alice', cheapest?.id ?? '', { store })
    expect(equippedItems(catalogue, await store.list())).toHaveLength(1)
  })

  it('only ever debits chips, never credits them', async () => {
    const ledger = new FakeLedger(10_000_000)
    for (const item of catalogue.slice(0, 5)) {
      await purchaseItem('alice', item.id, { ledger, store })
    }
    expect(ledger.entries.every((entry) => entry.delta < 0)).toBe(true)
  })
})
