import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  type Card,
  DEFAULT_STAKE,
  evaluateBest,
  HandCategory,
  makeDeck,
  preflopHandStrengthV2,
  type Rng,
} from '@river/engine'
import { riverBetBucket } from './bot-river-bet-model.js'
import { riverBetProbability } from './bot-river-scenarios.js'
import { RIVER_SIZE_TUNING, sizeProbabilities } from './bot-river-size-scenarios.js'

export const HELD_OUT_STYLES = [
  'value',
  'balanced',
  'overbluff',
  'camouflaged',
  'reverse-sizing',
] as const
export type HeldOutStyle = (typeof HELD_OUT_STYLES)[number]

export type StreetBucket = 'air' | 'draw' | 'pair' | 'strong'

interface PreflopShares {
  readonly open: number
  readonly call: number
  readonly reraise: number
}

interface StyleShape {
  readonly preflop: { readonly full: PreflopShares; readonly headsUp: PreflopShares }
  readonly maximumPreflopCallShare: number
  readonly betWhenCheckedTo: Readonly<Record<StreetBucket, number>>
  readonly maximumCallShare: Readonly<Record<StreetBucket, number>>
  readonly raiseStrong: number
}

/**
 * Whole-hand versions of the river styles in `bot-river-scenarios.ts`.
 *
 * The river bet frequency and every bet size come from the river scenario
 * tables, so these players are the same value, balanced, overbluff,
 * camouflaged and reverse-sizing bettors that docs/design/32 measured on
 * single river spots. The preflop, flop and turn numbers are authored stress
 * behaviour for those styles, not models of real players. Preflop ranges are
 * shares of the 1,326 starting hands, turned into `preflopHandStrengthV2`
 * thresholds from that score's own distribution; heads-up ranges are wider
 * because a two-player table is played that way.
 */
export const BOT_STYLE_TUNING: Readonly<Record<HeldOutStyle, StyleShape>> = {
  value: {
    preflop: {
      full: { open: 0.11, call: 0.07, reraise: 0.015 },
      headsUp: { open: 0.55, call: 0.45, reraise: 0.06 },
    },
    maximumPreflopCallShare: 0.35,
    betWhenCheckedTo: { air: 0, draw: 0.15, pair: 0.35, strong: 0.95 },
    maximumCallShare: { air: 0, draw: 0.22, pair: 0.3, strong: 1 },
    raiseStrong: 0.35,
  },
  balanced: {
    preflop: {
      full: { open: 0.17, call: 0.11, reraise: 0.02 },
      headsUp: { open: 0.7, call: 0.55, reraise: 0.1 },
    },
    maximumPreflopCallShare: 0.38,
    betWhenCheckedTo: { air: 0.25, draw: 0.5, pair: 0.45, strong: 0.85 },
    maximumCallShare: { air: 0, draw: 0.28, pair: 0.38, strong: 1 },
    raiseStrong: 0.3,
  },
  overbluff: {
    preflop: {
      full: { open: 0.25, call: 0.17, reraise: 0.04 },
      headsUp: { open: 0.8, call: 0.65, reraise: 0.15 },
    },
    maximumPreflopCallShare: 0.42,
    betWhenCheckedTo: { air: 0.55, draw: 0.75, pair: 0.7, strong: 0.9 },
    maximumCallShare: { air: 0, draw: 0.33, pair: 0.45, strong: 1 },
    raiseStrong: 0.4,
  },
  camouflaged: {
    preflop: {
      full: { open: 0.17, call: 0.11, reraise: 0.02 },
      headsUp: { open: 0.7, call: 0.55, reraise: 0.1 },
    },
    maximumPreflopCallShare: 0.38,
    betWhenCheckedTo: { air: 0.45, draw: 0.5, pair: 0.3, strong: 0.7 },
    maximumCallShare: { air: 0, draw: 0.28, pair: 0.38, strong: 1 },
    raiseStrong: 0.25,
  },
  'reverse-sizing': {
    preflop: {
      full: { open: 0.17, call: 0.11, reraise: 0.02 },
      headsUp: { open: 0.7, call: 0.55, reraise: 0.1 },
    },
    maximumPreflopCallShare: 0.38,
    betWhenCheckedTo: { air: 0.25, draw: 0.5, pair: 0.45, strong: 0.85 },
    maximumCallShare: { air: 0, draw: 0.28, pair: 0.38, strong: 1 },
    raiseStrong: 0.3,
  },
}

const PREFLOP_OPEN_BIG_BLINDS = 3
const PREFLOP_RERAISE_MULTIPLE = 3
const BIG_BLIND_OPTION_RAISE_RATE = 0.7

export function heldOutStylePolicy(
  style: HeldOutStyle,
  bigBlind: number = DEFAULT_STAKE.bigBlind,
): BotPolicy {
  return {
    id: `held-out-${style}`,
    version: 1,
    decide(context) {
      const { observation, rng } = context
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: observation.version,
        decision:
          observation.street === 'preflop'
            ? preflopDecision(BOT_STYLE_TUNING[style], observation, rng, bigBlind)
            : postflopDecision(style, observation, rng),
        fallbackReason: null,
      }
    },
  }
}

export function streetBucket(hole: readonly Card[], board: readonly Card[]): StreetBucket {
  const category = evaluateBest([...hole, ...board]).category
  if (category >= HandCategory.TWO_PAIR) return 'strong'
  if (category === HandCategory.PAIR) return 'pair'
  if (board.length < 5) {
    for (const card of hole) {
      if ([...hole, ...board].filter((visible) => visible.suit === card.suit).length === 4) {
        return 'draw'
      }
    }
  }
  return 'air'
}

const STARTING_HAND_SCORES: readonly number[] = (() => {
  const deck = makeDeck()
  const scores: number[] = []
  for (let first = 0; first < deck.length; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      scores.push(preflopHandStrengthV2([deck[first] as Card, deck[second] as Card]))
    }
  }
  return scores.sort((a, b) => a - b)
})()

export function preflopThresholdForShare(share: number): number {
  if (!(share > 0 && share <= 1)) throw new Error('a preflop share must be in (0, 1]')
  const index = Math.floor((1 - share) * (STARTING_HAND_SCORES.length - 1))
  return STARTING_HAND_SCORES[index] as number
}

function preflopDecision(
  shape: StyleShape,
  observation: BotObservationV1,
  rng: Rng,
  bigBlind: number,
): BotDecision {
  const score = preflopHandStrengthV2(observation.actor.hole)
  const seated = observation.seats.filter((seat) => seat.playerId !== null).length
  const shares = seated <= 2 ? shape.preflop.headsUp : shape.preflop.full
  const { amountToCall, currentBet, pot } = observation
  const opens = score >= preflopThresholdForShare(shares.open)
  if (amountToCall === 0) {
    return opens && rng() < BIG_BLIND_OPTION_RAISE_RATE
      ? sized(observation, bigBlind * PREFLOP_OPEN_BIG_BLINDS)
      : { kind: 'check' }
  }
  if (currentBet <= bigBlind) {
    return opens ? sized(observation, bigBlind * PREFLOP_OPEN_BIG_BLINDS) : { kind: 'fold' }
  }
  if (score >= preflopThresholdForShare(shares.reraise)) {
    return sized(observation, currentBet * PREFLOP_RERAISE_MULTIPLE)
  }
  const share = amountToCall / Math.max(1, pot + amountToCall)
  return score >= preflopThresholdForShare(shares.call) && share <= shape.maximumPreflopCallShare
    ? { kind: 'call' }
    : { kind: 'fold' }
}

function postflopDecision(
  style: HeldOutStyle,
  observation: BotObservationV1,
  rng: Rng,
): BotDecision {
  const shape = BOT_STYLE_TUNING[style]
  const { actor, board, amountToCall, pot } = observation
  const category = evaluateBest([...actor.hole, ...board]).category
  const bucket = streetBucket(actor.hole, board)
  if (amountToCall > 0) {
    const share = amountToCall / Math.max(1, pot + amountToCall)
    if (bucket === 'strong' && rng() < shape.raiseStrong) {
      return sized(observation, observation.currentBet + Math.round((pot + amountToCall) * 0.75))
    }
    return share <= shape.maximumCallShare[bucket] ? { kind: 'call' } : { kind: 'fold' }
  }
  const betRate =
    observation.street === 'river'
      ? riverBetProbability(style, category)
      : shape.betWhenCheckedTo[bucket]
  if (rng() >= betRate) return { kind: 'check' }
  const sizeBucket = riverBetBucket(bucket === 'draw' ? HandCategory.HIGH_CARD : category)
  const [small, medium] = sizeProbabilities(style, sizeBucket) as readonly [number, number, number]
  const draw = rng()
  const ratio =
    draw < small
      ? RIVER_SIZE_TUNING.smallPotRatio
      : draw < small + medium
        ? RIVER_SIZE_TUNING.mediumPotRatio
        : RIVER_SIZE_TUNING.largePotRatio
  return sized(observation, Math.round(pot * ratio))
}

function sized(observation: BotObservationV1, target: number): BotDecision {
  const { raiseTo, allIn, check } = observation.legal
  if (raiseTo.enabled && raiseTo.min <= raiseTo.max) {
    return { kind: 'raiseTo', to: Math.min(raiseTo.max, Math.max(raiseTo.min, target)) }
  }
  if (allIn.enabled) return { kind: 'allIn' }
  return check ? { kind: 'check' } : { kind: 'call' }
}
