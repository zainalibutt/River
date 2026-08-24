export type CosmeticSlot = 'head' | 'face' | 'torso' | 'hands' | 'accent'

export type CosmeticRarity = 'standard' | 'sharp' | 'signature'

export interface Cosmetic {
  id: string
  name: string
  slot: CosmeticSlot
  rarity: CosmeticRarity
  priceChips: number
  paletteIndex: number
}

export interface Loadout {
  head: string | null
  face: string | null
  torso: string | null
  hands: string | null
  accent: string | null
}

const CATALOGUE: readonly Cosmetic[] = [
  {
    id: 'cap-grey',
    name: 'Grey Flat Cap',
    slot: 'head',
    rarity: 'standard',
    priceChips: 400,
    paletteIndex: 0,
  },
  {
    id: 'cap-navy',
    name: 'Navy Bucket Cap',
    slot: 'head',
    rarity: 'standard',
    priceChips: 450,
    paletteIndex: 1,
  },
  {
    id: 'cap-tan',
    name: 'Tan Fedora',
    slot: 'head',
    rarity: 'sharp',
    priceChips: 1_800,
    paletteIndex: 2,
  },
  {
    id: 'cap-silk',
    name: 'Silk Top Hat',
    slot: 'head',
    rarity: 'signature',
    priceChips: 120_000,
    paletteIndex: 3,
  },
  {
    id: 'glasses-round',
    name: 'Round Wire Glasses',
    slot: 'face',
    rarity: 'standard',
    priceChips: 300,
    paletteIndex: 4,
  },
  {
    id: 'glasses-shade',
    name: 'Shutter Shades',
    slot: 'face',
    rarity: 'sharp',
    priceChips: 2_200,
    paletteIndex: 5,
  },
  {
    id: 'glasses-mono',
    name: 'Single Lens Monocle',
    slot: 'face',
    rarity: 'signature',
    priceChips: 130_000,
    paletteIndex: 6,
  },
  {
    id: 'jacket-leather',
    name: 'Black Leather Jacket',
    slot: 'torso',
    rarity: 'standard',
    priceChips: 900,
    paletteIndex: 7,
  },
  {
    id: 'jacket-bomb',
    name: 'Grey Bomber Jacket',
    slot: 'torso',
    rarity: 'standard',
    priceChips: 950,
    paletteIndex: 8,
  },
  {
    id: 'jacket-pinstripe',
    name: 'Pinstripe Blazer',
    slot: 'torso',
    rarity: 'sharp',
    priceChips: 4_000,
    paletteIndex: 9,
  },
  {
    id: 'jacket-cardinal',
    name: 'Cardinal Overcoat',
    slot: 'torso',
    rarity: 'signature',
    priceChips: 140_000,
    paletteIndex: 10,
  },
  {
    id: 'ring-signet',
    name: 'Gold Signet Ring',
    slot: 'hands',
    rarity: 'standard',
    priceChips: 500,
    paletteIndex: 11,
  },
  {
    id: 'ring-silver',
    name: 'Silver Ring',
    slot: 'hands',
    rarity: 'standard',
    priceChips: 450,
    paletteIndex: 12,
  },
  {
    id: 'ring-jade',
    name: 'Jade Ring',
    slot: 'hands',
    rarity: 'sharp',
    priceChips: 3_000,
    paletteIndex: 13,
  },
  {
    id: 'ring-pearl',
    name: 'Pearl Ring',
    slot: 'hands',
    rarity: 'signature',
    priceChips: 150_000,
    paletteIndex: 14,
  },
  {
    id: 'bandana-red',
    name: 'Red Bandana',
    slot: 'accent',
    rarity: 'standard',
    priceChips: 200,
    paletteIndex: 15,
  },
  {
    id: 'chain-gold',
    name: 'Gold Chain',
    slot: 'accent',
    rarity: 'sharp',
    priceChips: 2_800,
    paletteIndex: 16,
  },
  {
    id: 'watch-brass',
    name: 'Brass Pocket Watch',
    slot: 'accent',
    rarity: 'sharp',
    priceChips: 5_000,
    paletteIndex: 17,
  },
  {
    id: 'scarf-plaid',
    name: 'Plaid Scarf',
    slot: 'accent',
    rarity: 'standard',
    priceChips: 350,
    paletteIndex: 18,
  },
  {
    id: 'pin-diamond',
    name: 'Diamond Lapel Pin',
    slot: 'accent',
    rarity: 'signature',
    priceChips: 160_000,
    paletteIndex: 19,
  },
  {
    id: 'beanie-wool',
    name: 'Wool Beanie',
    slot: 'head',
    rarity: 'standard',
    priceChips: 380,
    paletteIndex: 20,
  },
  {
    id: 'scarf-silk',
    name: 'Silk Scarf',
    slot: 'accent',
    rarity: 'signature',
    priceChips: 170_000,
    paletteIndex: 21,
  },
]

export function cosmeticCatalogue(): readonly Cosmetic[] {
  return CATALOGUE
}

export function emptyLoadout(): Loadout {
  return {
    head: null,
    face: null,
    torso: null,
    hands: null,
    accent: null,
  }
}

export function equipCosmetic(loadout: Loadout, item: Cosmetic): Loadout {
  return {
    ...loadout,
    [item.slot]: item.id,
  }
}

export function loadoutCost(loadout: Loadout, catalogue: readonly Cosmetic[]): number {
  const byId = new Map(catalogue.map((item) => [item.id, item]))
  let total = 0
  for (const slot of SLOTS) {
    const id = loadout[slot]
    if (id === null) continue
    const item = byId.get(id)
    if (item === undefined) continue
    total += item.priceChips
  }
  return total
}

export function paletteIndices(loadout: Loadout, catalogue: readonly Cosmetic[]): number[] {
  const byId = new Map(catalogue.map((item) => [item.id, item]))
  const indices: number[] = []
  for (const slot of SLOTS) {
    const id = loadout[slot]
    if (id === null) continue
    const item = byId.get(id)
    if (item === undefined) continue
    indices.push(item.paletteIndex)
  }
  return indices
}

const SLOTS: readonly CosmeticSlot[] = ['head', 'face', 'torso', 'hands', 'accent']
