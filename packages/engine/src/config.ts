import type { BotProfile, BotSkill } from './bots.js'

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

export const BOT_PROFILES: Record<BotSkill, BotProfile> = {
  rookie: {
    skill: 'rookie',
    label: 'Rookie',
    aggression: 0.2,
    looseness: 0.4,
    bluffRate: 0.02,
    raiseFloor: 0.32,
    callFloor: 0.05,
    rerollFloor: 0.12,
    allInFloor: 0.6,
  },
  novice: {
    skill: 'novice',
    label: 'Novice',
    aggression: 0.3,
    looseness: 0.2,
    bluffRate: 0.04,
    raiseFloor: 0.44,
    callFloor: 0.0,
    rerollFloor: 0.22,
    allInFloor: 0.8,
  },
  og: {
    skill: 'og',
    label: 'OG',
    aggression: 0.5,
    looseness: 0.08,
    bluffRate: 0.06,
    raiseFloor: 0.4,
    callFloor: -0.05,
    rerollFloor: 0.3,
    allInFloor: 0.9,
  },
} satisfies Record<BotSkill, BotProfile>
