import type { BotPolicy, BotPolicyContextV1, Card } from '@river/engine'
import type { MoveClass } from './bot-lbr-range.js'

export type HoldingShares = (hole: readonly [Card, Card]) => number

/** Optional distribution hook. Call only on a disposable, isolated query policy. */
export interface LbrQueryPolicy extends BotPolicy {
  moveShares?(context: BotPolicyContextV1, taken: MoveClass): HoldingShares | null
}

export function policyMoveShares(
  policy: BotPolicy,
  context: BotPolicyContextV1,
  taken: MoveClass,
): HoldingShares | null {
  return (policy as LbrQueryPolicy).moveShares?.(context, taken) ?? null
}
