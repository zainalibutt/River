import type { Street } from './betting.js'
import { boardTexture } from './board-texture.js'
import { equityCoreDecision } from './bot-equity-core.js'
import { hasDraw, holdingOf } from './bot-holding.js'
import type { BotPersonality } from './bot-personality.js'
import { BOT_PREFLOP_SCORE_TUNING, preflopHandStrengthV2 } from './bot-preflop.js'
import type { Card } from './cards.js'
import { rankValue } from './cards.js'
import { evaluateBest } from './evaluator.js'
import { type HandAction, isAggressiveHandAction } from './hand-history.js'
import type { OpponentModelSummaryV1 } from './opponent-model.js'
import type { OpponentStatsSummaryV2 } from './opponent-stats.js'
import type { Rng } from './rng.js'

export type BotSkill = 'rookie' | 'novice' | 'og'

export const BOT_SKILL_TUNING: Readonly<
  Record<BotSkill, { readonly evaluationNoise: number; readonly looseCallRate: number }>
> = {
  rookie: { evaluationNoise: 0.14, looseCallRate: 1 },
  novice: { evaluationNoise: 0.07, looseCallRate: 0.65 },
  og: { evaluationNoise: 0.02, looseCallRate: 0.3 },
}

export const BOT_STRATEGY_TUNING = {
  earlyPosition: { callFloor: 0.12, raiseFloor: 0.06, looseness: -0.12 },
  latePosition: { callFloor: -0.27, raiseFloor: -0.08, looseness: 0.12 },
  flushDrawEquity: { flop: 0.35, turn: 9 / 46 },
  actionPressure: { largeBetPotRatio: 0.65, largeBet: 0.04, sustained: 0.03, reraised: 0.02 },
  opponentRead: {
    minimumConfidence: 0.25,
    maxCallFloorAdjustment: 0.05,
    looseAggression: 0.65,
    lowShowdown: 0.2,
    tightAggression: 0.3,
    highShowdown: 0.4,
  },
  checkedBluff: { share: 0.5, potRatio: 0.66 },
} as const

/**
 * Which parts of the OG's strategy are switched on. Rookie and novice ignore
 * all of them.
 *
 * `bluffRaises` decides what a personality's bluff rate does when facing a bet:
 * `any-hand` raises the minimum plus 100 chips with any two cards, `with-equity`
 * raises properly only with a draw after the flop or a suited, connected or
 * paired hand before it, and `never` spends none of it on raises.
 * `preflopRanking` uses the ranked preflop score (docs/design/32) instead of
 * the pair-bonus score. `checkedBluffs` lets a heads-up OG bet air or a draw on
 * the turn or river when it would check. `equityCore` replaces the OG's
 * postflop play with equity against the opponents' public ranges and balanced
 * bluffing (bot-equity-core.ts).
 */
export type BluffRaises = 'any-hand' | 'with-equity' | 'never'

export interface RuleStrategyOptions {
  readonly preflopRanking: boolean
  readonly bluffRaises: BluffRaises
  readonly checkedBluffs: boolean
  readonly equityCore: boolean
}

export const LEGACY_RULE_STRATEGY: RuleStrategyOptions = {
  preflopRanking: false,
  bluffRaises: 'any-hand',
  checkedBluffs: false,
  equityCore: false,
}

export interface PublicActionSummary {
  readonly lastAggressorSeat: number | null
  readonly raisesThisStreet: number
  readonly lastAggressivePotRatio: number | null
  readonly consecutiveAggressiveStreets: number
}

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

export interface BotTiltState {
  readonly factor: number
  readonly cause?: string
  readonly updatedAtMs?: number
}

export type BotFallbackReason = 'policy_error' | 'invalid_envelope' | 'unsupported_observation'

export interface BotSeatObservationV1 {
  readonly seat: number
  readonly playerId: string | null
  readonly stack: number
  readonly betHand: number
  readonly betStreet: number
  readonly folded: boolean
  readonly allIn: boolean
  readonly away: boolean
}

export interface BotOpponentSummaryV1 extends OpponentModelSummaryV1 {
  readonly playerId: string
}

export interface BotOpponentStatsV2 extends OpponentStatsSummaryV2 {
  readonly playerId: string
}

export interface BotLegalActionsV1 {
  readonly fold: boolean
  readonly check: boolean
  readonly call: { readonly enabled: boolean; readonly amount: number }
  readonly raiseTo: { readonly enabled: boolean; readonly min: number; readonly max: number }
  readonly allIn: { readonly enabled: boolean; readonly amount: number }
}

export interface BotObservationV1 {
  readonly version: 1
  readonly roomId: string
  readonly handNumber: number
  readonly actor: {
    readonly playerId: string
    readonly seat: number
    readonly hole: readonly Card[]
    readonly stack: number
    readonly betHand: number
    readonly betStreet: number
  }
  readonly street: Street
  readonly board: readonly Card[]
  readonly dealerSeat?: number
  readonly pot: number
  readonly currentBet: number
  readonly amountToCall: number
  readonly legal: BotLegalActionsV1
  readonly seats: readonly BotSeatObservationV1[]
  readonly opponents: readonly BotOpponentSummaryV1[]
  readonly opponentStats?: readonly BotOpponentStatsV2[]
  readonly actions?: readonly HandAction[]
  readonly tilt: BotTiltState
}

export interface BotPolicyContextV1 {
  readonly observation: BotObservationV1
  readonly profile: BotProfile
  readonly personality: BotPersonality
  readonly tilt: BotTiltState
  readonly rng: Rng
}

export interface BotDecisionEnvelope {
  readonly policyId: string
  readonly policyVersion: number
  readonly observationVersion: 1
  readonly decision: BotDecision
  readonly fallbackReason: BotFallbackReason | null
}

export interface BotPolicy {
  readonly id: string
  readonly version: number
  decide(context: BotPolicyContextV1): BotDecisionEnvelope
}

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

export function normalizeBotTilt(tilt: BotTiltState | undefined): BotTiltState {
  const factor = tilt === undefined || !Number.isFinite(tilt.factor) ? 0 : clamp01(tilt.factor)
  return {
    factor,
    ...(tilt?.cause === undefined ? {} : { cause: tilt.cause }),
    ...(tilt?.updatedAtMs === undefined || !Number.isFinite(tilt.updatedAtMs)
      ? {}
      : { updatedAtMs: tilt.updatedAtMs }),
  }
}

export function decisionInputFromObservation(observation: BotObservationV1): BotDecisionInput {
  return {
    street: observation.street,
    hole: [...observation.actor.hole],
    board: [...observation.board],
    betToCall: observation.amountToCall,
    pot: observation.pot,
    minRaiseTo: observation.legal.raiseTo.min,
    currentBet: observation.currentBet,
    stack: observation.actor.stack,
    betThisStreet: observation.actor.betStreet,
  }
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

export function decideBotTurn(
  input: BotDecisionInput,
  profile: BotProfile,
  rng: Rng,
  preflopStrength?: number,
  bluffRaises: BluffRaises = 'any-hand',
): BotDecision {
  const baseStrength =
    input.street === 'preflop'
      ? (preflopStrength ?? holeStrength(input.hole))
      : openStrength(input.hole, input.board)
  const strength = clamp01(baseStrength + evaluationNoise(profile.skill, rng))
  const facing = input.betToCall > 0
  const edge = strength - potOdds(input)
  const roll = rng()

  if (facing && profile.bluffRate > 0 && roll < profile.bluffRate) {
    if (bluffRaises === 'any-hand') {
      const to = Math.min(input.minRaiseTo + 100, input.stack + input.betThisStreet)
      if (to >= input.stack + input.betThisStreet) return { kind: 'allIn' }
      return { kind: 'raiseTo', to }
    }
    if (bluffRaises === 'with-equity' && bluffHasEquity(input)) {
      return aggressiveDecision(input, profile)
    }
  }

  if (facing) {
    if (edge >= profile.rerollFloor) return aggressiveDecision(input, profile)
    if (edge >= profile.callFloor) return { kind: 'call' }
    if (roll < profile.looseness * looseCallRate(profile.skill) && potOdds(input) < 0.4) {
      return { kind: 'call' }
    }
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

export function rulePolicy(id: string, version: number, strategy: RuleStrategyOptions): BotPolicy {
  return {
    id,
    version,
    decide(context) {
      return {
        policyId: id,
        policyVersion: version,
        observationVersion: context.observation.version,
        decision: decideObservedTurn(context, strategy),
        fallbackReason: null,
      }
    },
  }
}

/**
 * The live OG strategy since version 5: no pure bluff-raise and the ranked
 * preflop score. Both were adopted from paired whole-session evaluation on
 * fresh held-out seeds (docs/design/39); checked-to bluffs and raises with
 * equity were measured and not adopted.
 */
export const LIVE_RULE_STRATEGY: RuleStrategyOptions = {
  preflopRanking: true,
  bluffRaises: 'never',
  checkedBluffs: false,
  equityCore: false,
}

export const deterministicRulePolicy: BotPolicy = rulePolicy(
  'deterministic-rule',
  5,
  LIVE_RULE_STRATEGY,
)

/** Version 4, kept so earlier records stay reproducible. */
export const legacyRulePolicy: BotPolicy = rulePolicy('deterministic-rule', 4, LEGACY_RULE_STRATEGY)

export const strongPreflopRulePolicy: BotPolicy = rulePolicy('strong-preflop-candidate', 1, {
  ...LEGACY_RULE_STRATEGY,
  preflopRanking: true,
})

function decideObservedTurn(
  context: BotPolicyContextV1,
  strategy: RuleStrategyOptions,
): BotDecision {
  const og = context.profile.skill === 'og'
  if (strategy.equityCore && og) {
    const postflop = equityCoreDecision(context.observation, context.profile, context.rng)
    if (postflop !== null) return postflop
  }
  const usePreflopV2 = strategy.preflopRanking && og
  const input = decisionInputFromObservation(context.observation)
  const pricedDraw = pricedFlushDrawDecision(context.observation, input, context.profile.skill)
  if (pricedDraw !== null) return pricedDraw
  const positioned = profileForPosition(context.profile, context.observation)
  const preflopStrength =
    usePreflopV2 && context.profile.skill === 'og' && context.observation.street === 'preflop'
      ? preflopHandStrengthV2(context.observation.actor.hole)
      : undefined
  const profile = profileForOpponentRead(
    profileForActionPressure(positioned, context.observation),
    context.observation,
  )
  const boundedProfile =
    preflopStrength === undefined
      ? profile
      : {
          ...profile,
          bluffRate: Math.min(
            profile.bluffRate,
            BOT_PREFLOP_SCORE_TUNING.maximumCandidateBluffRate,
          ),
        }
  const decision = decideBotTurn(
    input,
    boundedProfile,
    context.rng,
    preflopStrength,
    og ? strategy.bluffRaises : 'any-hand',
  )
  if (
    preflopStrength !== undefined &&
    decision.kind === 'allIn' &&
    input.betToCall > 0 &&
    preflopStrength < BOT_PREFLOP_SCORE_TUNING.minimumFacingAllInScore
  ) {
    return { kind: 'fold' }
  }
  if (
    preflopStrength !== undefined &&
    decision.kind === 'allIn' &&
    input.betToCall === 0 &&
    input.stack / Math.max(1, input.pot) > BOT_PREFLOP_SCORE_TUNING.maximumOpenShoveStackToPot
  ) {
    return aggressiveDecision(input, boundedProfile)
  }
  if (strategy.checkedBluffs && og) {
    return checkedBluff(context.observation, boundedProfile, decision, context.rng) ?? decision
  }
  return decision
}

function checkedBluff(
  observation: BotObservationV1,
  profile: BotProfile,
  decision: BotDecision,
  rng: Rng,
): BotDecision | null {
  const { street, legal, amountToCall, pot, actor } = observation
  if (
    decision.kind !== 'check' ||
    (street !== 'turn' && street !== 'river') ||
    amountToCall !== 0 ||
    !legal.raiseTo.enabled
  ) {
    return null
  }
  const others = observation.seats.filter(
    (seat) => seat.playerId !== null && seat.playerId !== actor.playerId && !seat.folded,
  )
  if (others.length !== 1) return null
  const holding = holdingOf(actor.hole, observation.board)
  if (holding !== 'air' && holding !== 'draw') return null
  if (rng() >= profile.bluffRate * BOT_STRATEGY_TUNING.checkedBluff.share) return null
  return {
    kind: 'raiseTo',
    to: Math.min(
      legal.raiseTo.max,
      Math.max(legal.raiseTo.min, Math.round(pot * BOT_STRATEGY_TUNING.checkedBluff.potRatio)),
    ),
  }
}

function bluffHasEquity(input: BotDecisionInput): boolean {
  if (input.street !== 'preflop') return hasDraw(input.hole, input.board)
  const [first, second] = input.hole
  if (first === undefined || second === undefined) return false
  const gap = Math.abs(rankValue(first.rank) - rankValue(second.rank))
  return first.suit === second.suit || gap <= 1
}

function profileForOpponentRead(profile: BotProfile, observation: BotObservationV1): BotProfile {
  if (
    profile.skill !== 'og' ||
    observation.amountToCall === 0 ||
    observation.actions === undefined
  ) {
    return profile
  }
  const actionSummary = summarisePublicActions(observation.actions, observation.street)
  if (actionSummary.lastAggressorSeat === null) return profile
  const aggressorId = observation.seats.find(
    (seat) => seat.seat === actionSummary.lastAggressorSeat,
  )?.playerId
  if (aggressorId === null || aggressorId === undefined) return profile
  const opponent = observation.opponents.find((summary) => summary.playerId === aggressorId)
  if (
    opponent === undefined ||
    opponent.confidence < BOT_STRATEGY_TUNING.opponentRead.minimumConfidence
  ) {
    return profile
  }
  const confidence =
    (opponent.confidence - BOT_STRATEGY_TUNING.opponentRead.minimumConfidence) /
    (1 - BOT_STRATEGY_TUNING.opponentRead.minimumConfidence)
  const looseRead =
    opponent.aggressionFrequency >= BOT_STRATEGY_TUNING.opponentRead.looseAggression &&
    opponent.showdownFrequency <= BOT_STRATEGY_TUNING.opponentRead.lowShowdown
  const tightRead =
    opponent.aggressionFrequency <= BOT_STRATEGY_TUNING.opponentRead.tightAggression &&
    opponent.showdownFrequency >= BOT_STRATEGY_TUNING.opponentRead.highShowdown
  if (!looseRead && !tightRead) return profile
  const adjustment = BOT_STRATEGY_TUNING.opponentRead.maxCallFloorAdjustment * clamp01(confidence)
  return {
    ...profile,
    callFloor: profile.callFloor + (looseRead ? -adjustment : adjustment),
  }
}

export function summarisePublicActions(
  actions: readonly HandAction[],
  currentStreet: Street,
): PublicActionSummary {
  const aggressiveByStreet = new Map<Street, number>()
  let lastAggressorSeat: number | null = null
  let lastAggressivePotRatio: number | null = null
  let raisesThisStreet = 0
  const highestStreetBet = new Map<Street, number>()

  for (const entry of actions) {
    const priorHigh = highestStreetBet.get(entry.street) ?? 0
    const streetBet = entry.streetBetAfter
    const aggressive = isAggressiveHandAction(entry, priorHigh)
    if (aggressive) {
      aggressiveByStreet.set(entry.street, entry.seat)
      if (entry.street === currentStreet) {
        lastAggressorSeat = entry.seat
        raisesThisStreet += 1
        lastAggressivePotRatio =
          entry.amountCommitted === undefined || entry.potBefore === undefined
            ? null
            : entry.amountCommitted / Math.max(1, entry.potBefore)
      }
    }
    if (streetBet !== undefined) highestStreetBet.set(entry.street, Math.max(priorHigh, streetBet))
  }

  let consecutiveAggressiveStreets = 0
  if (lastAggressorSeat !== null) {
    const streets: readonly Street[] = ['preflop', 'flop', 'turn', 'river']
    for (let index = streets.indexOf(currentStreet); index >= 0; index -= 1) {
      if (aggressiveByStreet.get(streets[index] as Street) !== lastAggressorSeat) break
      consecutiveAggressiveStreets += 1
    }
  }
  return {
    lastAggressorSeat,
    raisesThisStreet,
    lastAggressivePotRatio,
    consecutiveAggressiveStreets,
  }
}

function profileForActionPressure(profile: BotProfile, observation: BotObservationV1): BotProfile {
  if (
    profile.skill !== 'og' ||
    observation.amountToCall === 0 ||
    observation.actions === undefined
  ) {
    return profile
  }
  const summary = summarisePublicActions(observation.actions, observation.street)
  if (
    summary.lastAggressorSeat === null ||
    summary.lastAggressorSeat === observation.actor.seat ||
    summary.lastAggressivePotRatio === null ||
    summary.lastAggressivePotRatio < BOT_STRATEGY_TUNING.actionPressure.largeBetPotRatio
  ) {
    return profile
  }
  const pressure =
    BOT_STRATEGY_TUNING.actionPressure.largeBet +
    (summary.consecutiveAggressiveStreets >= 2 ? BOT_STRATEGY_TUNING.actionPressure.sustained : 0) +
    (summary.raisesThisStreet >= 2 ? BOT_STRATEGY_TUNING.actionPressure.reraised : 0)
  return {
    ...profile,
    callFloor: profile.callFloor + pressure,
    rerollFloor: profile.rerollFloor + pressure,
  }
}

function pricedFlushDrawDecision(
  observation: BotObservationV1,
  input: BotDecisionInput,
  skill: BotSkill,
): BotDecision | null {
  if (skill !== 'og' || input.betToCall === 0) return null
  const equity = flushDrawEquity(observation)
  if (equity === null) return null
  return equity >= potOdds(input) ? { kind: 'call' } : { kind: 'fold' }
}

function flushDrawEquity(observation: BotObservationV1): number | null {
  if (observation.street !== 'flop' && observation.street !== 'turn') return null
  const texture = boardTexture(observation.board)
  if (texture.rankPattern !== 'unpaired' || texture.maxSameSuit >= 3) return null
  for (const suit of ['s', 'h', 'd', 'c'] as const) {
    const holeCards = observation.actor.hole.filter((card) => card.suit === suit).length
    const totalCards = [...observation.actor.hole, ...observation.board].filter(
      (card) => card.suit === suit,
    ).length
    if (holeCards > 0 && totalCards === 4) {
      return BOT_STRATEGY_TUNING.flushDrawEquity[observation.street]
    }
  }
  return null
}

function profileForPosition(profile: BotProfile, observation: BotObservationV1): BotProfile {
  if (observation.street !== 'preflop') return profile
  const adjustment = positionAdjustment(observation)
  if (adjustment === null) return profile
  return {
    ...profile,
    callFloor: profile.callFloor + adjustment.callFloor,
    raiseFloor: clamp01(profile.raiseFloor + adjustment.raiseFloor),
    looseness: clamp01(profile.looseness + adjustment.looseness),
  }
}

function positionAdjustment(
  observation: BotObservationV1,
):
  | (typeof BOT_STRATEGY_TUNING)['earlyPosition']
  | (typeof BOT_STRATEGY_TUNING)['latePosition']
  | null {
  const occupied = observation.seats.filter((seat) => seat.playerId !== null && !seat.away)
  if (occupied.length < 4 || observation.dealerSeat === undefined) return null
  const ordered = [...occupied].sort((left, right) => left.seat - right.seat)
  const dealerIndex = ordered.findIndex((seat) => seat.seat === observation.dealerSeat)
  const actorIndex = ordered.findIndex((seat) => seat.playerId === observation.actor.playerId)
  if (dealerIndex < 0 || actorIndex < 0) return null
  const offset = (actorIndex - dealerIndex + ordered.length) % ordered.length
  if (offset === 0 || offset >= ordered.length - 2) return BOT_STRATEGY_TUNING.latePosition
  if (offset >= 3 && offset <= Math.floor(ordered.length / 2)) {
    return BOT_STRATEGY_TUNING.earlyPosition
  }
  return null
}

function evaluationNoise(skill: BotSkill, rng: Rng): number {
  return (rng() * 2 - 1) * BOT_SKILL_TUNING[skill].evaluationNoise
}

function looseCallRate(skill: BotSkill): number {
  return BOT_SKILL_TUNING[skill].looseCallRate
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
