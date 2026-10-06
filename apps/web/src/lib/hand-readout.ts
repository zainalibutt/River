import type { Card } from '@river/engine'
import { evaluateBest, nameHand, shortName } from '@river/engine'

export interface HandReadout {
  /** "Two pair, kings and eights" */
  full: string
  /** "Two pair, K8" - fits a chip beside the cards. */
  short: string
}

/**
 * What the player is currently holding, in words.
 *
 * Five cards is the minimum a hand can be evaluated from, so preflop and a
 * two-card board return null rather than naming something that is not a hand
 * yet. Saying "ace high" over two hole cards would be a claim about a hand the
 * player has not been dealt.
 */
export function readoutFor(hole: readonly Card[], board: readonly Card[]): HandReadout | null {
  const cards = [...hole, ...board]
  if (hole.length < 2 || cards.length < 5) return null
  const rank = evaluateBest(cards)
  return { full: nameHand(rank), short: shortName(rank) }
}
