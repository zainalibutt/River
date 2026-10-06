import { describe, expect, it } from 'vitest'
import type { Cosmetic, Loadout } from './cosmetics.js'
import {
  cosmeticCatalogue,
  emptyLoadout,
  equipCosmetic,
  loadoutCost,
  paletteIndices,
} from './cosmetics.js'

const SLOTS = ['head', 'face', 'torso', 'hands', 'accent'] as const
const RARITIES = ['standard', 'sharp', 'signature'] as const

describe('cosmeticCatalogue', () => {
  const catalogue = cosmeticCatalogue()

  it('has unique ids and positive whole-chip prices', () => {
    const ids = catalogue.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of catalogue) {
      expect(item.priceChips).toBeGreaterThan(0)
      expect(Number.isInteger(item.priceChips)).toBe(true)
    }
  })

  it('covers all five slots and all three rarities', () => {
    for (const slot of SLOTS) {
      expect(catalogue.some((item) => item.slot === slot)).toBe(true)
    }
    for (const rarity of RARITIES) {
      expect(catalogue.some((item) => item.rarity === rarity)).toBe(true)
    }
  })

  it('has at least twenty cosmetics', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(20)
  })

  it('keeps every palette index an integer in 0..255', () => {
    for (const item of catalogue) {
      expect(Number.isInteger(item.paletteIndex)).toBe(true)
      expect(item.paletteIndex).toBeGreaterThanOrEqual(0)
      expect(item.paletteIndex).toBeLessThan(256)
    }
  })

  it('charges every signature piece more than a 100,000 default buy-in', () => {
    const signature = catalogue.filter((item) => item.rarity === 'signature')
    expect(signature.length).toBeGreaterThan(0)
    for (const item of signature) {
      expect(item.priceChips).toBeGreaterThan(100_000)
    }
  })

  it('has at least one affordable standard piece per slot', () => {
    for (const slot of SLOTS) {
      const standard = catalogue.filter((item) => item.slot === slot && item.rarity === 'standard')
      expect(standard.length).toBeGreaterThan(0)
      for (const item of standard) {
        expect(item.priceChips).toBeLessThan(10_000)
      }
    }
  })
})

describe('equipCosmetic', () => {
  it('returns a new loadout and never mutates its argument', () => {
    const loadout = emptyLoadout()
    const item = itemFor('cap-grey')
    const next = equipCosmetic(loadout, item)
    expect(next).not.toBe(loadout)
    expect(loadout.head).toBeNull()
    expect(next.head).toBe('cap-grey')
  })

  it('replaces an occupied slot rather than stacking', () => {
    const loadout = equipCosmetic(emptyLoadout(), itemFor('cap-grey'))
    const next = equipCosmetic(loadout, itemFor('cap-navy'))
    expect(next.head).toBe('cap-navy')
    expect(next.face).toBeNull()
  })

  it('leaves other slots untouched when equipping one slot', () => {
    const loadout = equipCosmetic(emptyLoadout(), itemFor('jacket-leather'))
    const next = equipCosmetic(loadout, itemFor('cap-grey'))
    expect(next.torso).toBe('jacket-leather')
    expect(next.head).toBe('cap-grey')
  })
})

describe('emptyLoadout', () => {
  it('has every slot null and costs zero', () => {
    const loadout = emptyLoadout()
    for (const slot of SLOTS) {
      expect(loadout[slot]).toBeNull()
    }
    expect(loadoutCost(loadout, cosmeticCatalogue())).toBe(0)
    expect(paletteIndices(loadout, cosmeticCatalogue())).toHaveLength(0)
  })
})

describe('loadoutCost', () => {
  it('sums only equipped slots', () => {
    const catalogue = cosmeticCatalogue()
    const loadout = equipCosmetic(
      equipCosmetic(emptyLoadout(), itemFor('cap-grey')),
      itemFor('jacket-leather'),
    )
    expect(loadoutCost(loadout, catalogue)).toBe(priceOf('cap-grey') + priceOf('jacket-leather'))
  })

  it('ignores ids not in the catalogue rather than throwing', () => {
    const catalogue = cosmeticCatalogue()
    const loadout: Loadout = { ...emptyLoadout(), head: 'does-not-exist' }
    expect(loadoutCost(loadout, catalogue)).toBe(0)
  })
})

describe('paletteIndices', () => {
  it('returns one index per equipped slot, all integers in 0..255', () => {
    const catalogue = cosmeticCatalogue()
    const loadout = equipCosmetic(
      equipCosmetic(equipCosmetic(emptyLoadout(), itemFor('cap-grey')), itemFor('glasses-round')),
      itemFor('jacket-leather'),
    )
    const indices = paletteIndices(loadout, catalogue)
    expect(indices).toHaveLength(3)
    for (const index of indices) {
      expect(Number.isInteger(index)).toBe(true)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(256)
    }
  })

  it('ignores an unknown id when gathering indices', () => {
    const catalogue = cosmeticCatalogue()
    const loadout: Loadout = { ...emptyLoadout(), accent: 'not-real' }
    expect(paletteIndices(loadout, catalogue)).toHaveLength(0)
  })
})

function itemFor(id: string): Cosmetic {
  const item = cosmeticCatalogue().find((candidate) => candidate.id === id)
  if (item === undefined) throw new Error(`no catalogue item ${id}`)
  return item
}

function priceOf(id: string): number {
  const item = itemFor(id)
  return item.priceChips
}
