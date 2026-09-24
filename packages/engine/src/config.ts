import type { BotProfile, BotSkill } from './bots.js'
import type { OpponentModelTuning } from './opponent-model.js'
import type { OpponentStatsTuning } from './opponent-stats.js'

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

export const DEFAULT_OPPONENT_MODEL_TUNING: OpponentModelTuning = {
  halfLifeMs: 30 * 24 * 60 * 60 * 1_000,
  confidenceHands: 20,
  priorWeight: 8,
  priorVpip: 0.3,
  priorPfr: 0.18,
  priorAggression: 0.45,
  priorShowdown: 0.28,
  priorAggressivePotRatio: 0.65,
  maxAggressivePotRatio: 4,
}

/**
 * Population priors for the pooled public statistics.
 *
 * River has no human population yet, and its own rule bots are not a stand-in:
 * measured over 40 sessions of the ordinary tables they bet 1.9% of postflop
 * spots when checked to and raise 22-29% of the bets they face. These are
 * neutral assumptions, worth `priorStrength` opportunities each, to be replaced
 * by anonymous population statistics once people have played. VPIP and PFR
 * match the session model above.
 */
export const DEFAULT_OPPONENT_STATS_TUNING: OpponentStatsTuning = {
  halfLifeMs: DEFAULT_OPPONENT_MODEL_TUNING.halfLifeMs,
  priorStrength: 10,
  intervalZ: 1.645,
  priors: {
    vpip: DEFAULT_OPPONENT_MODEL_TUNING.priorVpip,
    pfr: DEFAULT_OPPONENT_MODEL_TUNING.priorPfr,
    foldToPreflopRaise: 0.5,
    foldToBet: 0.4,
    raiseVsBet: 0.1,
    betWhenCheckedTo: 0.35,
    riverBetWhenCheckedTo: 0.3,
  },
}

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
