export interface StakeConfig {
  id: string
  label: string
  smallBlind: number
  bigBlind: number
  minBuyIn: number
  maxBuyIn: number
  defaultBuyIn: number
}

export const STAKE_250_500: StakeConfig = {
  id: '250-500',
  label: '250/500',
  smallBlind: 250,
  bigBlind: 500,
  minBuyIn: 50_000,
  maxBuyIn: 200_000,
  defaultBuyIn: 100_000,
}

export const DEFAULT_STAKE = STAKE_250_500

export const TABLE_SHAPES = ['full', 'six', 'heads-up'] as const
export type TableShape = (typeof TABLE_SHAPES)[number]

export const SEATS_PER_SHAPE: Record<TableShape, number> = {
  full: 9,
  six: 6,
  'heads-up': 2,
}

export const DEFAULT_TABLE_SHAPE: TableShape = 'full'
