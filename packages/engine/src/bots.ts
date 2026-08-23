import type { Street } from './betting.js'
import type { Card } from './cards.js'
import { rankValue } from './cards.js'
import { evaluateBest } from './evaluator.js'
import type { Rng } from './rng.js'

export type BotSkill = 'rookie' | 'novice' | 'og'

export interface BotProfile {
  skill: BotSkill
  label: string
  aggression: number
  looseness: number
  bluffRate: number
  raiseFloor: number
  callFloor: number
  rerollFloor: number
  allInFloor: number
}

export type BotDecision =
  | { kind: 'check' }
  | { kind: 'fold' }
  | { kind: 'call' }
  | { kind: 'raiseTo'; to: number }
  | { kind: 'allIn' }

export interface BotDecisionInput {
  street: Street
  hole: Card[]
  board: Card[]
  betToCall: number
  pot: number
  minRaiseTo: number
  currentBet: number
  stack: number
  betThisStreet: number
}

function openStrength(hole: Card[], board: Card[]): number {
  const rank = evaluateBest([...hole, ...board])
  return rank.category / 8 + Math.min(0.04, (rank.ranks[0] ?? 0) / 700)
}

function holeStrength(hole: Card[]): number {
  const a = rankValue(hole[0]?.rank ?? '2')
  const b = rankValue(hole[1]?.rank ?? '2')
  const pairBonus = hole[0]?.rank === hole[1]?.rank ? 150 : 0
  const suitedBonus = hole[0]?.suit === hole[1]?.suit ? 20 : 0
  return Math.min(1, (a + b + pairBonus + suitedBonus) / 220)
}

function potOdds(input: BotDecisionInput): number {
  return input.betToCall / (input.pot + input.betToCall)
}

function aggressiveDecision(input: BotDecisionInput, profile: BotProfile): BotDecision {
  const max = input.stack + input.betThisStreet
  if (max < input.minRaiseTo) return { kind: 'allIn' }
  const to = Math.min(input.minRaiseTo + Math.floor(input.pot * (0.5 + profile.aggression)), max)
  return { kind: 'raiseTo', to: Math.max(to, input.minRaiseTo) }
}

export function decideBotTurn(input: BotDecisionInput, profile: BotProfile, rng: Rng): BotDecision {
  const strength =
    input.street === 'preflop' ? holeStrength(input.hole) : openStrength(input.hole, input.board)
  const facing = input.betToCall > 0
  const edge = strength - potOdds(input)
  const roll = rng()

  if (facing && profile.bluffRate > 0 && roll < profile.bluffRate) {
    const to = Math.min(input.minRaiseTo + 100, input.stack + input.betThisStreet)
    if (to >= input.stack + input.betThisStreet) return { kind: 'allIn' }
    return { kind: 'raiseTo', to }
  }

  if (facing) {
    if (edge >= profile.rerollFloor) return aggressiveDecision(input, profile)
    if (edge >= profile.callFloor) return { kind: 'call' }
    if (roll < profile.looseness && potOdds(input) < 0.4) return { kind: 'call' }
    return { kind: 'fold' }
  }

  if (strength >= profile.raiseFloor && roll < profile.aggression + 0.3) {
    if (strength >= profile.allInFloor && rng() < profile.aggression * 0.6 + 0.1) {
      return { kind: 'allIn' }
    }
    return aggressiveDecision(input, profile)
  }
  if (
    strength >= profile.allInFloor &&
    input.currentBet === 0 &&
    rng() < profile.aggression * 0.4
  ) {
    return { kind: 'allIn' }
  }

  return { kind: 'check' }
}
