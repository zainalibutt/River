export type TableItemSlot = 'left' | 'right' | 'behind' | 'on-table'
export type TableItemTier = 'common' | 'rare' | 'signature'

export interface TableItem {
  id: string
  name: string
  priceChips: number
  repModifier: number
  slot: TableItemSlot
  tier: TableItemTier
}

const CATALOGUE: readonly TableItem[] = [
  {
    id: 'beer-mug',
    name: 'Beer Mug',
    priceChips: 8_000,
    repModifier: 0.03,
    slot: 'left',
    tier: 'common',
  },
  {
    id: 'lucky-coin',
    name: 'Lucky Coin',
    priceChips: 5_000,
    repModifier: 0.02,
    slot: 'right',
    tier: 'common',
  },
  {
    id: 'plant-fern',
    name: 'Fern Pot',
    priceChips: 12_000,
    repModifier: 0.03,
    slot: 'behind',
    tier: 'common',
  },
  {
    id: 'card-guard',
    name: 'Card Guard',
    priceChips: 6_000,
    repModifier: 0.02,
    slot: 'on-table',
    tier: 'common',
  },
  {
    id: 'cigar-box',
    name: 'Cigar Box',
    priceChips: 40_000,
    repModifier: 0.05,
    slot: 'left',
    tier: 'rare',
  },
  {
    id: 'bust-trophy',
    name: 'Bust Trophy',
    priceChips: 60_000,
    repModifier: 0.06,
    slot: 'right',
    tier: 'rare',
  },
  {
    id: 'wall-banner',
    name: 'Champion Banner',
    priceChips: 45_000,
    repModifier: 0.05,
    slot: 'behind',
    tier: 'rare',
  },
  {
    id: 'gold-plaque',
    name: 'Gold Plaque',
    priceChips: 55_000,
    repModifier: 0.06,
    slot: 'on-table',
    tier: 'rare',
  },
  {
    id: 'velvet-throne',
    name: 'Velvet Throne',
    priceChips: 250_000,
    repModifier: 0.1,
    slot: 'left',
    tier: 'signature',
  },
  {
    id: 'neon-sign',
    name: 'Neon Name Sign',
    priceChips: 180_000,
    repModifier: 0.08,
    slot: 'right',
    tier: 'signature',
  },
  {
    id: 'golden-rig',
    name: 'Golden Fortune Rig',
    priceChips: 300_000,
    repModifier: 0.12,
    slot: 'behind',
    tier: 'signature',
  },
  {
    id: 'diamond-chip-set',
    name: 'Diamond Chip Set',
    priceChips: 220_000,
    repModifier: 0.09,
    slot: 'on-table',
    tier: 'signature',
  },
]

export function itemCatalogue(): readonly TableItem[] {
  return CATALOGUE
}

export function equippedModifiers(equipped: readonly TableItem[]): number[] {
  return equipped.map((item) => item.repModifier)
}

export function canEquip(equipped: readonly TableItem[], item: TableItem): boolean {
  return equipped.every((existing) => existing.slot !== item.slot)
}

export function totalCost(items: readonly TableItem[]): number {
  return items.reduce((sum, item) => sum + item.priceChips, 0)
}
