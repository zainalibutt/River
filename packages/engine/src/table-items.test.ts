import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TableItem } from './table-items.js'
import { canEquip, equippedModifiers, itemCatalogue, totalCost } from './table-items.js'

const CATALOGUE = itemCatalogue()
const SLOTS = ['left', 'right', 'behind', 'on-table'] as const
const TIERS = ['common', 'rare', 'signature'] as const

function byId(id: string): TableItem {
  const item = CATALOGUE.find((candidate) => candidate.id === id)
  if (item === undefined) throw new Error(`catalogue has no item ${id}`)
  return item
}

describe('table item catalogue', () => {
  it('has unique ids across the full catalogue', () => {
    const ids = CATALOGUE.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prices are positive integers', () => {
    for (const item of CATALOGUE) {
      expect(Number.isSafeInteger(item.priceChips)).toBe(true)
      expect(item.priceChips).toBeGreaterThan(0)
    }
  })

  it('keeps every rep modifier positive and under 0.25', () => {
    for (const item of CATALOGUE) {
      expect(item.repModifier).toBeGreaterThan(0)
      expect(item.repModifier).toBeLessThan(0.25)
    }
  })

  it('spans every slot and every tier', () => {
    for (const slot of SLOTS) {
      expect(CATALOGUE.some((item) => item.slot === slot)).toBe(true)
    }
    for (const tier of TIERS) {
      expect(CATALOGUE.some((item) => item.tier === tier)).toBe(true)
    }
  })

  it('includes at least twelve items with a signature price above a full buy-in', () => {
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(12)
    for (const item of CATALOGUE) {
      if (item.tier === 'signature') {
        expect(item.priceChips).toBeGreaterThan(100_000)
      }
    }
  })

  it('imports nothing from betting, shuffle, fairness or evaluator', () => {
    const source = readFileSync(fileURLToPath(new URL('./table-items.ts', import.meta.url)), 'utf8')
    for (const forbidden of ['betting', 'shuffle', 'fairness', 'evaluator']) {
      expect(source).not.toMatch(new RegExp(`from '.*${forbidden}\\.js'`))
    }
  })
})

describe('equipping table items', () => {
  it('refuses a second item in an occupied slot and allows a free one', () => {
    const beer = byId('beer-mug')
    const cigar = byId('cigar-box')
    const coin = byId('lucky-coin')
    expect(beer.slot).toBe('left')
    expect(cigar.slot).toBe('left')
    expect(coin.slot).toBe('right')
    expect(canEquip([beer], cigar)).toBe(false)
    expect(canEquip([beer], coin)).toBe(true)
    expect(canEquip([], beer)).toBe(true)
  })

  it('returns one modifier per equipped item in order', () => {
    const beer = byId('beer-mug')
    const coin = byId('lucky-coin')
    expect(equippedModifiers([beer, coin])).toEqual([0.03, 0.02])
  })

  it('returns an empty list for no equipment', () => {
    expect(equippedModifiers([])).toEqual([])
  })
})

describe('table item cost', () => {
  it('sums exactly and costs zero when empty', () => {
    const beer = byId('beer-mug')
    const coin = byId('lucky-coin')
    expect(totalCost([beer, coin])).toBe(13_000)
    expect(totalCost([])).toBe(0)
  })
})
