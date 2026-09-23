import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  boardTexture,
  deterministicRulePolicy,
  evaluateBest,
  HandCategory,
} from '@river/engine'

export const BOT_POKER_GUARD_TUNING = {
  madeDrawMaximumCallShare: 0.4,
} as const

export const pokerGuardPolicy: BotPolicy = {
  id: 'poker-guard',
  version: 1,
  decide(context) {
    const baseline = deterministicRulePolicy.decide(context)
    const decision =
      context.profile.skill === 'og'
        ? pokerGuardDecision(context.observation, baseline.decision)
        : baseline.decision
    return {
      ...baseline,
      policyId: this.id,
      policyVersion: this.version,
      decision,
    }
  },
}

export function pokerGuardDecision(
  observation: BotObservationV1,
  baseline: BotDecision,
): BotDecision {
  const { actor, board, legal, amountToCall, pot, street } = observation
  if (
    (street === 'flop' || street === 'turn') &&
    amountToCall > 0 &&
    legal.call.enabled &&
    baseline.kind === 'fold' &&
    amountToCall / Math.max(1, pot + amountToCall) <=
      BOT_POKER_GUARD_TUNING.madeDrawMaximumCallShare
  ) {
    const texture = boardTexture(board)
    if (texture.rankPattern !== 'unpaired' || texture.maxSameSuit >= 3) return baseline
    const made = evaluateBest([...actor.hole, ...board])
    const drawSuit = actor.hole.find(
      (card) =>
        [...actor.hole, ...board].filter((visible) => visible.suit === card.suit).length === 4,
    )?.suit
    const minimumMadeCategory = street === 'flop' ? HandCategory.STRAIGHT : HandCategory.TWO_PAIR
    if (drawSuit !== undefined && made.category >= minimumMadeCategory) {
      return { kind: 'call' }
    }
  }
  return baseline
}
