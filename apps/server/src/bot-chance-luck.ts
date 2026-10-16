import type { Card } from '@river/engine'
import { showdownShare } from './bot-allin-equity.js'

/**
 * The cards' luck in a heads-up hand, to take out of its result (a chance-only
 * correction in the spirit of MIVAT and AIVAT). Each time board cards are dealt
 * while the betting is still open, the focal seat's showdown share against the
 * opponent's actual holding moves from what it was before the cards to what it
 * is after. That move, times the pot already in, is luck: over every card that
 * could have come it averages to exactly zero, whatever either player does
 * later, so taking it out leaves the expected result unchanged and removes some
 * of its noise. Only two-seat hands qualify, where both holdings are every card
 * dealt and so the cards still to come are exactly the rest of the deck.
 */
export interface BoardDeal {
  /** The board before and after the cards were dealt. */
  readonly before: readonly Card[]
  readonly after: readonly Card[]
  /** Chips in the pot when they were dealt. */
  readonly pot: number
}

export function chanceLuck(
  focal: readonly Card[],
  other: readonly Card[],
  deals: readonly BoardDeal[],
  seed: string,
): number {
  let luck = 0
  deals.forEach((deal, index) => {
    const before = showdownShare(focal, other, deal.before, `${seed}:${index}:before`)
    const after = showdownShare(focal, other, deal.after, `${seed}:${index}:after`)
    luck += deal.pot * (after - before)
  })
  return luck
}
