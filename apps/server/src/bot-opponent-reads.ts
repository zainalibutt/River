import {
  type BotDecision,
  type BotObservationV1,
  type BotOpponentStatsV2,
  type BotPolicy,
  DEFAULT_OPPONENT_STATS_TUNING,
  holdingOf,
  type OpponentStatsStateV2,
  type OpponentStatsTuning,
  publicEvidenceFromHand,
  type RateEstimate,
  summariseOpponentStats,
  updateOpponentStats,
} from '@river/engine'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import type { FocalMemoryPlugin } from './bot-session-benchmark.js'

/**
 * When a public read may change an OG decision.
 *
 * Each rule compares a posterior bound with the price that makes the play
 * break even, plus a margin, so a read only acts once the evidence clears the
 * arithmetic rather than a style label. `minimumOpportunities` is a floor on
 * the statistic's own opportunities, whatever its bounds say. A bluff is pot
 * sized because a fold rate is mostly observed against the OG's own bets,
 * which are the minimum plus about a pot; players fold less to smaller bets.
 */
export const OPPONENT_READ_TUNING = {
  minimumOpportunities: 6,
  breakEvenMargin: 0.05,
  bluffPotRatio: 1,
  valuePotRatio: 0.5,
  aggressiveBettorLow: 0.6,
  bluffCatchMaximumCallShare: 0.4,
  stationFoldHigh: 0.3,
} as const

export type ReadRule = 'bluff-catch' | 'fold-equity-bluff' | 'station-value'

/**
 * The live policy without the OG's any-hand raise when facing a bet.
 *
 * docs/design/37 measured that raise as the live OG's largest leak, so a read
 * is judged against this control: a candidate compared only with the live
 * policy would take credit for removing the leak rather than for reading.
 */
export const leakFreeControlPolicy: BotPolicy = {
  id: 'leak-free-control',
  version: 1,
  decide(context) {
    const profile =
      context.profile.skill === 'og' ? { ...context.profile, bluffRate: 0 } : context.profile
    const envelope = legacyGuardPolicy.decide({ ...context, profile })
    return { ...envelope, policyId: this.id, policyVersion: this.version }
  },
}

export function opponentReadPolicy(
  options: { readonly base?: BotPolicy; readonly onRead?: (rule: ReadRule) => void } = {},
): BotPolicy {
  const base = options.base ?? leakFreeControlPolicy
  return {
    id: 'opponent-read-candidate',
    version: 1,
    decide(context) {
      const envelope = base.decide(context)
      const read =
        context.profile.skill === 'og' ? readDecision(context.observation, envelope.decision) : null
      if (read !== null) options.onRead?.(read.rule)
      return {
        ...envelope,
        policyId: this.id,
        policyVersion: this.version,
        decision: read?.decision ?? envelope.decision,
      }
    },
  }
}

export function readDecision(
  observation: BotObservationV1,
  baseline: BotDecision,
): { readonly rule: ReadRule; readonly decision: BotDecision } | null {
  if (observation.street === 'preflop' || observation.opponentStats === undefined) return null
  const others = observation.seats.filter(
    (seat) =>
      seat.playerId !== null && seat.playerId !== observation.actor.playerId && !seat.folded,
  )
  const opponentId = others.length === 1 ? others[0]?.playerId : undefined
  const stats = observation.opponentStats.find((entry) => entry.playerId === opponentId)
  if (stats === undefined) return null
  const holding = holdingOf(observation.actor.hole, observation.board)
  const { amountToCall, pot, legal } = observation
  const tuning = OPPONENT_READ_TUNING

  if (amountToCall > 0) {
    const price = amountToCall / Math.max(1, pot + amountToCall)
    if (
      baseline.kind === 'fold' &&
      legal.call.enabled &&
      (holding === 'pair' || holding === 'strong') &&
      price <= tuning.bluffCatchMaximumCallShare &&
      established(stats.betWhenCheckedTo) &&
      stats.betWhenCheckedTo.low >= tuning.aggressiveBettorLow
    ) {
      return { rule: 'bluff-catch', decision: { kind: 'call' } }
    }
    return null
  }

  if (baseline.kind !== 'check' || !legal.check || !legal.raiseTo.enabled) return null
  if (
    (holding === 'air' || holding === 'draw') &&
    folds(stats) >= breakEven(tuning.bluffPotRatio) + tuning.breakEvenMargin
  ) {
    return { rule: 'fold-equity-bluff', decision: bet(observation, tuning.bluffPotRatio) }
  }
  if (
    (holding === 'pair' || holding === 'strong') &&
    established(stats.foldToBet) &&
    stats.foldToBet.high <= tuning.stationFoldHigh
  ) {
    return { rule: 'station-value', decision: bet(observation, tuning.valuePotRatio) }
  }
  return null
}

export function opponentStatsPlugin(
  tuning: OpponentStatsTuning = DEFAULT_OPPONENT_STATS_TUNING,
): () => FocalMemoryPlugin {
  return () => {
    const states = new Map<string, OpponentStatsStateV2>()
    return {
      observe(hand, opponentIds) {
        for (const opponentId of opponentIds) {
          const evidence = publicEvidenceFromHand(
            hand.record,
            opponentId,
            hand.shown.get(opponentId) ?? null,
          )
          if (evidence === null) continue
          states.set(
            opponentId,
            updateOpponentStats(states.get(opponentId) ?? null, evidence, hand.atMs, tuning),
          )
        }
      },
      actionOptions: () => ({
        opponentStats: [...states].map(
          ([playerId, state]): BotOpponentStatsV2 => ({
            playerId,
            ...summariseOpponentStats(state, tuning),
          }),
        ),
      }),
    }
  }
}

function folds(stats: BotOpponentStatsV2): number {
  return established(stats.foldToBet) ? stats.foldToBet.low : 0
}

function established(rate: RateEstimate): boolean {
  return rate.opportunities >= OPPONENT_READ_TUNING.minimumOpportunities
}

function breakEven(potRatio: number): number {
  return potRatio / (1 + potRatio)
}

function bet(observation: BotObservationV1, potRatio: number): BotDecision {
  const { raiseTo } = observation.legal
  return {
    kind: 'raiseTo',
    to: Math.min(raiseTo.max, Math.max(raiseTo.min, Math.round(observation.pot * potRatio))),
  }
}
