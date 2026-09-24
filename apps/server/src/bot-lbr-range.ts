import {
  type BotDecision,
  type BotObservationV1,
  type BotPersonality,
  type BotPolicy,
  blend,
  type Card,
  cardKey,
  type HandAction,
  isAggressiveHandAction,
  makeDeck,
  mulberry32,
  seedFromString,
} from '@river/engine'
import { decideWithFallback, profileFor } from './bot-service.js'

/**
 * How finely a best-response opponent tracks the focal seat's range. Each
 * holding's weight is multiplied by an estimate of how often the focal policy
 * makes the move it made; the estimate comes from asking the policy on a few
 * random streams, and `smoothing` keeps a holding the samples happened to miss
 * from dropping out for good.
 */
export const LBR_RANGE_TUNING = {
  samplesPerHolding: 4,
  maximumHoldings: 220,
  smoothing: 0.02,
} as const

export interface WeightedHolding {
  readonly hole: readonly [Card, Card]
  weight: number
}

export type MoveClass = 'fold' | 'passive' | 'aggressive'

/** Every starting hand the focal seat could hold, given cards the observer can see. */
export function candidateHoldings(visible: readonly Card[], seed: string): WeightedHolding[] {
  const blocked = new Set(visible.map(cardKey))
  const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const all: WeightedHolding[] = []
  for (let first = 0; first < deck.length; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      all.push({ hole: [deck[first] as Card, deck[second] as Card], weight: 1 })
    }
  }
  if (all.length <= LBR_RANGE_TUNING.maximumHoldings) return all
  const random = mulberry32(seedFromString(seed))
  for (let index = all.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[all[index], all[swap]] = [all[swap] as WeightedHolding, all[index] as WeightedHolding]
  }
  return all.slice(0, LBR_RANGE_TUNING.maximumHoldings)
}

/**
 * Fold, check-or-call, or bet-or-raise, as the table will treat a decision. A
 * raise the seat cannot make above the current bet is only a call.
 */
export function decisionClass(decision: BotDecision, observation: BotObservationV1): MoveClass {
  if (decision.kind === 'fold') return 'fold'
  if (decision.kind === 'check' || decision.kind === 'call') return 'passive'
  const reach = observation.actor.stack + observation.actor.betStreet
  const target = decision.kind === 'raiseTo' ? Math.min(decision.to, reach) : reach
  return target > observation.currentBet ? 'aggressive' : 'passive'
}

/** The class of a move the table recorded, taken from the state it was made in. */
export function recordedClass(entry: HandAction, observation: BotObservationV1): MoveClass {
  if (entry.action.kind === 'fold') return 'fold'
  return isAggressiveHandAction(entry, observation.currentBet) ? 'aggressive' : 'passive'
}

/**
 * How often the focal policy makes a move of class `taken` from this public
 * state with a given holding, estimated by asking the policy itself on a few
 * seeded random streams. This is what a best-response opponent is allowed to
 * know: the policy, never the dealt cards.
 */
export function moveFrequency(
  policy: BotPolicy,
  personality: BotPersonality,
  observation: BotObservationV1,
  hole: readonly [Card, Card],
  taken: MoveClass,
  seed: string,
): number {
  const tilted = blend(personality, observation.tilt.factor)
  const swapped: BotObservationV1 = {
    ...observation,
    actor: { ...observation.actor, hole: [...hole] },
  }
  let matches = 0
  for (let sample = 0; sample < LBR_RANGE_TUNING.samplesPerHolding; sample += 1) {
    const decision = decideWithFallback(policy, {
      observation: swapped,
      profile: profileFor(tilted),
      personality: tilted,
      tilt: swapped.tilt,
      rng: mulberry32(seedFromString(`${seed}:${sample}`)),
    }).decision
    if (decisionClass(decision, swapped) === taken) matches += 1
  }
  return matches / LBR_RANGE_TUNING.samplesPerHolding
}

/** Reweights a range by one observed focal move; holdings clashing with the board drop out. */
export function updateRange(
  range: WeightedHolding[],
  policy: BotPolicy,
  personality: BotPersonality,
  observation: BotObservationV1,
  taken: MoveClass,
  seed: string,
): void {
  const board = new Set(observation.board.map(cardKey))
  const { samplesPerHolding, smoothing } = LBR_RANGE_TUNING
  for (const holding of range) {
    if (board.has(cardKey(holding.hole[0])) || board.has(cardKey(holding.hole[1]))) {
      holding.weight = 0
      continue
    }
    if (holding.weight === 0) continue
    const frequency = moveFrequency(policy, personality, observation, holding.hole, taken, seed)
    holding.weight *=
      (frequency * samplesPerHolding + smoothing) / (samplesPerHolding + 2 * smoothing)
  }
}
