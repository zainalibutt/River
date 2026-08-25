import { itemCatalogue, type TableItem } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  actionLabel,
  equippedRatePercent,
  isActionable,
  type OwnedEntry,
  shopRows,
  shopStateFor,
} from './shop.js'

const catalogue = itemCatalogue()
const cheapest = [...catalogue].sort((a, b) => a.priceChips - b.priceChips)[0]
if (cheapest === undefined) throw new Error('the catalogue is empty')
// Bound to a narrowed const: a module-level throw does not narrow inside a
// function body, because TypeScript cannot prove it ran first.
const cheap: TableItem = cheapest

function owned(over: Partial<OwnedEntry> = {}): OwnedEntry[] {
  const base: OwnedEntry = { itemId: cheap.id, slot: cheap.slot, equipped: false }
  return [{ ...base, ...over }]
}

describe('shop rows', () => {
  it('offers an item the player can afford', () => {
    expect(shopStateFor(cheap, [], cheap.priceChips)).toBe('buyable')
  })

  it('locks an item the player cannot afford', () => {
    expect(shopStateFor(cheap, [], cheap.priceChips - 1)).toBe('unaffordable')
  })

  it('never shows an owned item as unaffordable, however broke the player is', () => {
    expect(shopStateFor(cheap, owned(), 0)).toBe('owned')
    expect(shopStateFor(cheap, owned({ equipped: true }), 0)).toBe('equipped')
  })

  it('reports exactly what is missing on a locked row', () => {
    const rows = shopRows([cheap], [], cheap.priceChips - 250)
    expect(rows[0]?.shortfall).toBe(250)
  })

  it('reports no shortfall on a row that is not locked', () => {
    const rows = shopRows([cheap], [], cheap.priceChips)
    expect(rows[0]?.shortfall).toBe(0)
  })

  it('returns one row per catalogue item, in order', () => {
    const rows = shopRows(catalogue, [], 0)
    expect(rows).toHaveLength(catalogue.length)
    expect(rows.map((row) => row.item.id)).toEqual(catalogue.map((item) => item.id))
  })

  it('offers an action only where one would succeed', () => {
    expect(isActionable('buyable')).toBe(true)
    expect(isActionable('owned')).toBe(true)
    expect(isActionable('unaffordable')).toBe(false)
    expect(isActionable('equipped')).toBe(false)
  })

  it('labels every state without falling through to a blank button', () => {
    for (const state of ['buyable', 'owned', 'equipped', 'unaffordable'] as const) {
      expect(actionLabel(state).length).toBeGreaterThan(0)
    }
  })

  it('reports a hundred percent when nothing is equipped', () => {
    expect(equippedRatePercent(catalogue, [])).toBe(100)
  })

  it('adds equipped modifiers rather than compounding them', () => {
    const two = catalogue.slice(0, 2)
    if (two.length < 2 || two[0] === undefined || two[1] === undefined) return
    const rate = equippedRatePercent(catalogue, [
      { itemId: two[0].id, slot: two[0].slot, equipped: true },
      { itemId: two[1].id, slot: two[1].slot, equipped: true },
    ])
    const expected = Math.round((1 + two[0].repModifier + two[1].repModifier) * 100)
    expect(rate).toBe(expected)
  })

  it('ignores unequipped items in the rate', () => {
    expect(equippedRatePercent(catalogue, owned())).toBe(100)
  })
})
