import type { Street } from './betting.js'
import type { Card } from './cards.js'
import { evaluateBest, HandCategory } from './evaluator.js'
import { type HandRecord, isAggressiveHandAction } from './hand-history.js'

export const PUBLIC_BET_SIZE_TUNING = {
  smallUpperRatio: 0.5,
  mediumUpperRatio: 1,
} as const

export type PublicBetSize = 'small' | 'medium' | 'large'
export const POSTFLOP_STREETS = ['flop', 'turn', 'river'] as const
export type PostflopStreet = (typeof POSTFLOP_STREETS)[number]

export interface PublicStreetEvidenceV2 {
  readonly facedBet: number
  readonly foldedToBet: number
  readonly raisedVsBet: number
  readonly checkedTo: number
  readonly betWhenCheckedTo: number
  readonly betSizes: Readonly<Record<PublicBetSize, number>>
}

/**
 * One player's accepted public actions in one settled hand, counted as
 * opportunities and outcomes.
 *
 * Everything here is read from the hand record, which holds accepted actions
 * and no hole cards, plus cards the table showed publicly. A fold is an
 * outcome of the spot the player faced, never a guess about what they held.
 */
export interface PublicHandEvidenceV2 {
  readonly vpip: boolean
  readonly pfr: boolean
  readonly facedPreflopRaise: number
  readonly foldedToPreflopRaise: number
  readonly streets: Readonly<Record<PostflopStreet, PublicStreetEvidenceV2>>
  readonly showed: boolean
  readonly shownRiverAggression: HandCategory | null
}

export function publicBetSize(amountCommitted: number, potBefore: number): PublicBetSize | null {
  if (!Number.isFinite(amountCommitted) || !Number.isFinite(potBefore) || potBefore <= 0) {
    return null
  }
  const ratio = amountCommitted / potBefore
  if (ratio <= 0) return null
  if (ratio <= PUBLIC_BET_SIZE_TUNING.smallUpperRatio) return 'small'
  return ratio <= PUBLIC_BET_SIZE_TUNING.mediumUpperRatio ? 'medium' : 'large'
}

export function publicEvidenceFromHand(
  record: HandRecord,
  playerId: string,
  shownHole: readonly Card[] | null = null,
): PublicHandEvidenceV2 | null {
  const seat = record.seats.find((entry) => entry.playerId === playerId)?.seat
  if (seat === undefined) return null
  const bigBlind = record.stake.bigBlind
  const highest = new Map<Street, number>([['preflop', bigBlind]])
  const committed = new Map<string, number>()
  const streets = {
    flop: emptyStreetEvidence(),
    turn: emptyStreetEvidence(),
    river: emptyStreetEvidence(),
  }
  let vpip = false
  let pfr = false
  let facedPreflopRaise = 0
  let foldedToPreflopRaise = 0
  let riverAggression = false

  for (const entry of record.actions) {
    const highBefore = highest.get(entry.street) ?? 0
    const key = `${entry.street}:${entry.seat}`
    const facing = highBefore > (committed.get(key) ?? 0) || entry.action.kind === 'call'
    const aggressive = isAggressiveHandAction(entry, highBefore)
    if (entry.seat === seat) {
      const kind = entry.action.kind
      if (entry.street === 'preflop') {
        if (kind === 'call' || kind === 'raiseTo' || kind === 'allIn') vpip = true
        if (aggressive) pfr = true
        if (facing && highBefore > bigBlind) {
          facedPreflopRaise += 1
          if (kind === 'fold') foldedToPreflopRaise += 1
        }
      } else {
        const street = streets[entry.street]
        if (facing) {
          street.facedBet += 1
          if (kind === 'fold') street.foldedToBet += 1
          if (aggressive) street.raisedVsBet += 1
        } else {
          street.checkedTo += 1
          if (aggressive) {
            street.betWhenCheckedTo += 1
            const size =
              entry.amountCommitted === undefined || entry.potBefore === undefined
                ? null
                : publicBetSize(entry.amountCommitted, entry.potBefore)
            if (size !== null) street.betSizes[size] += 1
          }
        }
        if (entry.street === 'river' && aggressive) riverAggression = true
      }
    }
    const after =
      entry.streetBetAfter ?? (entry.action.kind === 'raiseTo' ? entry.action.to : undefined)
    if (after !== undefined) {
      committed.set(key, after)
      highest.set(entry.street, Math.max(highBefore, after))
    }
  }

  const showed = record.results.some((entry) => entry.seat === seat && entry.showed)
  const canRead = showed && riverAggression && shownHole?.length === 2 && record.board.length === 5
  return {
    vpip,
    pfr,
    facedPreflopRaise,
    foldedToPreflopRaise,
    streets,
    showed,
    shownRiverAggression:
      canRead && shownHole !== null ? evaluateBest([...shownHole, ...record.board]).category : null,
  }
}

function emptyStreetEvidence(): {
  facedBet: number
  foldedToBet: number
  raisedVsBet: number
  checkedTo: number
  betWhenCheckedTo: number
  betSizes: Record<PublicBetSize, number>
} {
  return {
    facedBet: 0,
    foldedToBet: 0,
    raisedVsBet: 0,
    checkedTo: 0,
    betWhenCheckedTo: 0,
    betSizes: { small: 0, medium: 0, large: 0 },
  }
}

export type ShownRiverBucket = 'air' | 'pair' | 'made'

export interface OpponentStatsTuning {
  readonly halfLifeMs: number
  readonly priorStrength: number
  readonly intervalZ: number
  readonly priors: {
    readonly vpip: number
    readonly pfr: number
    readonly foldToPreflopRaise: number
    readonly foldToBet: number
    readonly raiseVsBet: number
    readonly betWhenCheckedTo: number
    readonly riverBetWhenCheckedTo: number
  }
}

/**
 * Decayed public counts for one opponent, pooled across the postflop streets.
 *
 * Pooling is deliberate: a nine-seat session yields a handful of river spots
 * per player but several times as many checked-to spots across flop, turn and
 * river (docs/design/37), so a read built on one street stays unknown for most
 * of a session.
 */
export interface OpponentStatsStateV2 {
  readonly version: 2
  readonly lastSeenAtMs: number
  readonly hands: number
  readonly vpip: number
  readonly pfr: number
  readonly facedPreflopRaise: number
  readonly foldedToPreflopRaise: number
  readonly facedBet: number
  readonly foldedToBet: number
  readonly raisedVsBet: number
  readonly checkedTo: number
  readonly betWhenCheckedTo: number
  readonly riverCheckedTo: number
  readonly riverBetWhenCheckedTo: number
  readonly betSizes: Readonly<Record<PublicBetSize, number>>
  readonly showed: number
  readonly shownRiverAggression: Readonly<Record<ShownRiverBucket, number>>
}

/**
 * A rate with its evidence and a credible interval.
 *
 * The estimate is a Beta posterior whose prior is the population rate worth
 * `priorStrength` opportunities; the bounds are the posterior mean plus or
 * minus `intervalZ` standard deviations. A read is only as strong as its own
 * opportunities, so a player seen folding twice stays close to the population.
 */
export interface RateEstimate {
  readonly successes: number
  readonly opportunities: number
  readonly mean: number
  readonly low: number
  readonly high: number
}

export interface OpponentStatsSummaryV2 {
  readonly version: 2
  readonly hands: number
  readonly vpip: RateEstimate
  readonly pfr: RateEstimate
  readonly foldToPreflopRaise: RateEstimate
  readonly foldToBet: RateEstimate
  readonly raiseVsBet: RateEstimate
  readonly betWhenCheckedTo: RateEstimate
  readonly riverBetWhenCheckedTo: RateEstimate
  readonly betSizes: Readonly<Record<PublicBetSize, number>>
  readonly shownRiverAggression: Readonly<Record<ShownRiverBucket, number>>
}

export function updateOpponentStats(
  previous: OpponentStatsStateV2 | null,
  evidence: PublicHandEvidenceV2,
  observedAtMs: number,
  tuning: OpponentStatsTuning,
): OpponentStatsStateV2 {
  const base = previous ?? emptyOpponentStats(observedAtMs)
  const decay = 2 ** (-Math.max(0, observedAtMs - base.lastSeenAtMs) / tuning.halfLifeMs)
  const sum = (field: Exclude<keyof PublicStreetEvidenceV2, 'betSizes'>) =>
    POSTFLOP_STREETS.reduce((total, street) => total + evidence.streets[street][field], 0)
  const sizes = (size: PublicBetSize) =>
    base.betSizes[size] * decay +
    POSTFLOP_STREETS.reduce((total, street) => total + evidence.streets[street].betSizes[size], 0)
  const shown = shownBucket(evidence.shownRiverAggression)
  const reveal = (bucket: ShownRiverBucket) =>
    base.shownRiverAggression[bucket] * decay + (shown === bucket ? 1 : 0)
  return {
    version: 2,
    lastSeenAtMs: Math.max(base.lastSeenAtMs, observedAtMs),
    hands: base.hands * decay + 1,
    vpip: base.vpip * decay + Number(evidence.vpip),
    pfr: base.pfr * decay + Number(evidence.pfr),
    facedPreflopRaise: base.facedPreflopRaise * decay + evidence.facedPreflopRaise,
    foldedToPreflopRaise: base.foldedToPreflopRaise * decay + evidence.foldedToPreflopRaise,
    facedBet: base.facedBet * decay + sum('facedBet'),
    foldedToBet: base.foldedToBet * decay + sum('foldedToBet'),
    raisedVsBet: base.raisedVsBet * decay + sum('raisedVsBet'),
    checkedTo: base.checkedTo * decay + sum('checkedTo'),
    betWhenCheckedTo: base.betWhenCheckedTo * decay + sum('betWhenCheckedTo'),
    riverCheckedTo: base.riverCheckedTo * decay + evidence.streets.river.checkedTo,
    riverBetWhenCheckedTo:
      base.riverBetWhenCheckedTo * decay + evidence.streets.river.betWhenCheckedTo,
    betSizes: { small: sizes('small'), medium: sizes('medium'), large: sizes('large') },
    showed: base.showed * decay + Number(evidence.showed),
    shownRiverAggression: { air: reveal('air'), pair: reveal('pair'), made: reveal('made') },
  }
}

export function summariseOpponentStats(
  state: OpponentStatsStateV2,
  tuning: OpponentStatsTuning,
): OpponentStatsSummaryV2 {
  const { priors } = tuning
  return {
    version: 2,
    hands: state.hands,
    vpip: rateEstimate(state.vpip, state.hands, priors.vpip, tuning),
    pfr: rateEstimate(state.pfr, state.hands, priors.pfr, tuning),
    foldToPreflopRaise: rateEstimate(
      state.foldedToPreflopRaise,
      state.facedPreflopRaise,
      priors.foldToPreflopRaise,
      tuning,
    ),
    foldToBet: rateEstimate(state.foldedToBet, state.facedBet, priors.foldToBet, tuning),
    raiseVsBet: rateEstimate(state.raisedVsBet, state.facedBet, priors.raiseVsBet, tuning),
    betWhenCheckedTo: rateEstimate(
      state.betWhenCheckedTo,
      state.checkedTo,
      priors.betWhenCheckedTo,
      tuning,
    ),
    riverBetWhenCheckedTo: rateEstimate(
      state.riverBetWhenCheckedTo,
      state.riverCheckedTo,
      priors.riverBetWhenCheckedTo,
      tuning,
    ),
    betSizes: { ...state.betSizes },
    shownRiverAggression: { ...state.shownRiverAggression },
  }
}

export function rateEstimate(
  successes: number,
  opportunities: number,
  prior: number,
  tuning: Pick<OpponentStatsTuning, 'priorStrength' | 'intervalZ'>,
): RateEstimate {
  const alpha = prior * tuning.priorStrength + successes
  const beta = (1 - prior) * tuning.priorStrength + Math.max(0, opportunities - successes)
  const mean = alpha / (alpha + beta)
  const spread = tuning.intervalZ * Math.sqrt((mean * (1 - mean)) / (alpha + beta + 1))
  return {
    successes,
    opportunities,
    mean,
    low: Math.max(0, mean - spread),
    high: Math.min(1, mean + spread),
  }
}

function shownBucket(category: HandCategory | null): ShownRiverBucket | null {
  if (category === null) return null
  if (category === HandCategory.HIGH_CARD) return 'air'
  return category === HandCategory.PAIR ? 'pair' : 'made'
}

function emptyOpponentStats(atMs: number): OpponentStatsStateV2 {
  return {
    version: 2,
    lastSeenAtMs: atMs,
    hands: 0,
    vpip: 0,
    pfr: 0,
    facedPreflopRaise: 0,
    foldedToPreflopRaise: 0,
    facedBet: 0,
    foldedToBet: 0,
    raisedVsBet: 0,
    checkedTo: 0,
    betWhenCheckedTo: 0,
    riverCheckedTo: 0,
    riverBetWhenCheckedTo: 0,
    betSizes: { small: 0, medium: 0, large: 0 },
    showed: 0,
    shownRiverAggression: { air: 0, pair: 0, made: 0 },
  }
}
