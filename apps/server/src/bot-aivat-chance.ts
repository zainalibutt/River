import type { Card } from '@river/engine'
import { showdownShare } from './bot-allin-equity.js'
import type { BoardDeal } from './bot-chance-luck.js'

/** Exact chance controls after the flop only. Showdown share is a martingale
 * over uniformly dealt boards conditional on BOTH private holdings. Never
 * select hands by whether they reached showdown or by terminal hole visibility.
 * Betting-closed runouts must not also receive an all-in value correction.
 * No preflop MC equity is used in this estimator's unbiasedness claim. */
export function lateBoardCorrection(
  focal: readonly Card[],
  other: readonly Card[],
  deals: readonly BoardDeal[],
): number {
  return deals.reduce((sum, deal) => {
    if (deal.before.length < 3) return sum
    if (
      deal.after.length !== deal.before.length + 1 ||
      deal.after.length > 5 ||
      !Number.isFinite(deal.pot) ||
      deal.pot < 0
    )
      throw new Error('invalid late board deal')
    const before = showdownShare(focal, other, deal.before, 'unused-exact')
    const after = showdownShare(focal, other, deal.after, 'unused-exact')
    return sum + deal.pot * (before - after)
  }, 0)
}
