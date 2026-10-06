import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  type Card,
  exactHeadsUpRiverEquity,
} from '@river/engine'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'

export const BOT_RIVER_CANDIDATE_TUNING = {
  minimumEdgeBeyondPotOdds: 0.08,
} as const

export const rejectedRiverRangePolicy: BotPolicy = {
  id: 'rejected-river-range-candidate',
  version: 1,
  decide(context) {
    const baseline = pokerStrongCandidatePolicy.decide(context)
    const decision =
      context.profile.skill === 'og'
        ? riverCallDecision(context.observation, baseline.decision)
        : baseline.decision
    return { ...baseline, policyId: this.id, policyVersion: this.version, decision }
  },
}

export function riverCallDecision(
  observation: BotObservationV1,
  baseline: BotDecision,
): BotDecision {
  const { actor, board, legal, amountToCall, pot, seats } = observation
  if (
    observation.street !== 'river' ||
    board.length !== 5 ||
    actor.hole.length !== 2 ||
    observation.actions === undefined ||
    !legal.fold ||
    !legal.call.enabled ||
    legal.call.amount !== amountToCall ||
    amountToCall <= 0 ||
    actor.stack < amountToCall ||
    pot <= 0 ||
    (baseline.kind !== 'call' && baseline.kind !== 'fold')
  ) {
    return baseline
  }
  const active = seats.filter((seat) => seat.playerId !== null && !seat.folded)
  if (active.length !== 2 || active.some((seat) => seat.allIn)) return baseline
  const shares = exactHeadsUpRiverEquity(actor.hole as readonly [Card, Card], board)
  const values = Object.values(shares).map((scenario) => scenario.potShare)
  const price = amountToCall / (pot + amountToCall)
  const margin = BOT_RIVER_CANDIDATE_TUNING.minimumEdgeBeyondPotOdds
  if (baseline.kind === 'fold' && Math.min(...values) > price + margin) return { kind: 'call' }
  if (baseline.kind === 'call' && Math.max(...values) < price - margin) return { kind: 'fold' }
  return baseline
}
