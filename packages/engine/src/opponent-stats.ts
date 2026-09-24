import type { Street } from './betting.js'
import type { Card } from './cards.js'
import { evaluateBest, type HandCategory } from './evaluator.js'
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
