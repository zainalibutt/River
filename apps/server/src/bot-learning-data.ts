import {
  type BotObservationV1,
  DEFAULT_STAKE,
  isAggressiveHandAction,
  type Street,
  type TurnAction,
} from '@river/engine'
import { type BenchmarkOptions, runBotBenchmark } from './bot-benchmark.js'

export const LEARNING_SCHEMA_VERSION = 1 as const

// Fixed schema order. Values are finite in [0, 1]; counts use n/(n+4), chip
// amounts use log1p(big blinds)/log1p(100) capped at 1, and shares use x/total.
export const LEARNING_FEATURES_V1: readonly string[] = [
  'street_preflop',
  'street_flop',
  'street_turn',
  'street_river',
  'facing_bet',
  'call_share_of_pot_after_call',
  'pot_log_100bb',
  'stack_log_100bb',
  'current_bet_log_100bb',
  'committed_share_of_actor_chips',
  'position_from_dealer',
  'active_player_fraction',
  'prior_action_count',
  'prior_aggressive_fraction',
  'prior_street_aggressive_fraction',
  'prior_actor_action_fraction',
  'legal_fold',
  'legal_check',
  'legal_call',
  'legal_raise',
] as const

export type LearningLabel = 'fold' | 'check' | 'call' | 'raise'

export interface LearningExampleV1 {
  readonly features: readonly number[]
  readonly label: LearningLabel
  readonly legalLabels: readonly LearningLabel[]
  readonly handId: string
  readonly actorId: string
}

const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river']
const LABELS: readonly LearningLabel[] = ['fold', 'check', 'call', 'raise']

export function collectLearningExamples(options: BenchmarkOptions): readonly LearningExampleV1[] {
  const examples: LearningExampleV1[] = []
  runBotBenchmark({
    ...options,
    onDecision(decision) {
      const { observation, action, handIndex, actorId } = decision
      const legalLabels = legalLabelsFor(observation)
      const label = labelFor(action, observation)
      if (!legalLabels.includes(label)) {
        throw new Error(`benchmark action has no legal learning label: ${action.kind}`)
      }
      examples.push({
        features: extractLearningFeaturesV1(observation),
        label,
        legalLabels,
        handId: JSON.stringify([options.seed, handIndex]),
        actorId,
      })
      options.onDecision?.(decision)
    },
  })
  return examples
}

export function extractLearningFeaturesV1(observation: BotObservationV1): readonly number[] {
  const actions = observation.actions ?? []
  const priorHigh = new Map<Street, number>()
  let aggressive = 0
  let streetAggressive = 0
  let actorActions = 0
  for (const entry of actions) {
    const high = priorHigh.get(entry.street) ?? 0
    if (isAggressiveHandAction(entry, high)) {
      aggressive += 1
      if (entry.street === observation.street) streetAggressive += 1
    }
    priorHigh.set(entry.street, Math.max(high, nonnegative(entry.streetBetAfter)))
    if (entry.seat === observation.actor.seat) actorActions += 1
  }
  const streetActions = actions.filter((entry) => entry.street === observation.street).length
  const occupied = observation.seats
    .filter((seat) => seat.playerId !== null)
    .sort((left, right) => left.seat - right.seat)
  const active = occupied.filter((seat) => !seat.folded && !seat.allIn && !seat.away).length
  const dealerIndex = occupied.findIndex((seat) => seat.seat === observation.dealerSeat)
  const actorIndex = occupied.findIndex((seat) => seat.seat === observation.actor.seat)
  const position =
    dealerIndex < 0 || actorIndex < 0 || occupied.length < 2
      ? 0
      : ((actorIndex - dealerIndex + occupied.length) % occupied.length) / (occupied.length - 1)
  const legalLabels = legalLabelsFor(observation)
  const features = [
    ...STREETS.map((street) => Number(observation.street === street)),
    Number(observation.amountToCall > 0),
    share(observation.amountToCall, observation.pot + observation.amountToCall),
    logBigBlinds(observation.pot),
    logBigBlinds(observation.actor.stack),
    logBigBlinds(observation.currentBet),
    share(observation.actor.betStreet, observation.actor.stack + observation.actor.betStreet),
    position,
    share(active, occupied.length),
    cappedCount(actions.length),
    share(aggressive, actions.length),
    share(streetAggressive, streetActions),
    share(actorActions, actions.length),
    ...LABELS.map((label) => Number(legalLabels.includes(label))),
  ]
  if (features.length !== LEARNING_FEATURES_V1.length)
    throw new Error('learning feature order mismatch')
  return features.map(unit)
}

export function legalLabelsFor(observation: BotObservationV1): readonly LearningLabel[] {
  const legal = observation.legal
  const passiveAllIn = legal.allIn.enabled && !allInRaises(observation)
  const aggressiveAllIn = legal.allIn.enabled && allInRaises(observation)
  return LABELS.filter((label) => {
    switch (label) {
      case 'fold':
        return legal.fold
      case 'check':
        return legal.check
      case 'call':
        return legal.call.enabled || passiveAllIn
      case 'raise':
        return legal.raiseTo.enabled || aggressiveAllIn
    }
    return false
  })
}

type AllInClassificationContext = {
  readonly actor: Pick<BotObservationV1['actor'], 'betStreet' | 'stack'>
  readonly currentBet: number
}

export function labelFor(
  action: TurnAction,
  observation: AllInClassificationContext,
): LearningLabel {
  switch (action.kind) {
    case 'fold':
      return 'fold'
    case 'check':
      return 'check'
    case 'call':
      return 'call'
    case 'raiseTo':
      return 'raise'
    case 'allIn':
      return allInRaises(observation) ? 'raise' : 'call'
  }
}

function allInRaises(observation: AllInClassificationContext): boolean {
  return observation.actor.betStreet + observation.actor.stack > observation.currentBet
}

function nonnegative(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, value)
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function share(part: number, whole: number): number {
  const numerator = nonnegative(part)
  const denominator = nonnegative(whole)
  return denominator > 0 ? unit(numerator / denominator) : 0
}

function cappedCount(count: number): number {
  return unit(nonnegative(count) / (nonnegative(count) + 4))
}

function logBigBlinds(chips: number): number {
  const blinds = nonnegative(chips) / DEFAULT_STAKE.bigBlind
  return unit(Math.log1p(blinds) / Math.log1p(100))
}
