import { compareRanks, type HandRank } from './evaluator.js'
import type { HandRecord } from './hand-history.js'

/**
 * A showdown, told one hand at a time in the order a dealer would call for them.
 *
 * The showdown used to be over in a caption: the pot moved, a name and a hand flashed up,
 * and the next deal came three seconds later whatever had happened. At a real table this
 * is the moment of the hand - players turn their cards over one after another, in an
 * order the rules fix, and the last one to show is the one everybody is waiting for.
 *
 * The server and the browser both read this schedule. The browser plays it; the server
 * holds the next deal back until it has finished, so a six-way showdown is never cut off
 * by the cards for the next hand arriving on top of it.
 */

/** Before anything is shown: the table goes quiet and the word goes up. */
export const SHOWDOWN_HUSH_MS = 900
/** One hand: its first card, its second, its name, and a beat to read it. */
export const SHOWDOWN_STEP_MS = 1_500
/** The second card turns this long after the first - one by one, not both at once. */
export const SHOWDOWN_SECOND_CARD_MS = 380
/** The hand's name arrives once both cards are over. */
export const SHOWDOWN_NAME_MS = 760
/** The held breath before the hand that decides it: the last one to show. */
export const SHOWDOWN_TENSION_MS = 1_200
/** The winner, and the pot going to them. */
export const SHOWDOWN_AWARD_HOLD_MS = 2_000
/** A losing hand thrown away unseen: long enough to read who passed, no longer. */
export const SHOWDOWN_MUCK_MS = 800
/**
 * After an all-in the hands were turned face up before the board was finished, so each one
 * only needs naming: no hush to open, no second card to wait for, no held breath.
 */
export const SHOWDOWN_TABLED_HUSH_MS = 300
export const SHOWDOWN_TABLED_STEP_MS = 950
export const SHOWDOWN_TABLED_NAME_MS = 200

export interface ShowdownStep {
  seat: number
  /** Milliseconds from the start of the showdown. */
  revealAtMs: number
  secondCardAtMs: number
  nameAtMs: number
  /** The deciding hand, shown after a pause everybody at the table can feel. */
  deciding: boolean
  /** A hand thrown away unseen: its turn says so, and no card is turned. */
  mucked: boolean
}

export interface ShowdownShowOptions {
  /** The hands were turned face up before the board was finished, at an all-in. */
  tabled?: boolean
  /** Seats whose turn throws their hand away instead of showing it. */
  mucked?: ReadonlySet<number>
}

export interface ShowdownShow {
  steps: ShowdownStep[]
  /** When the pot goes to the winner. */
  awardAtMs: number
  totalMs: number
}

/**
 * The schedule for the hands in `order`, first to last. A tabled showdown only names hands
 * already face up; a mucked turn is short and turns nothing over. The held breath comes
 * before the last turn whatever it brings, so it never says in advance who has won.
 */
export function showdownShow(
  order: readonly number[],
  options: ShowdownShowOptions = {},
): ShowdownShow {
  const tabled = options.tabled === true
  let cursor = tabled ? SHOWDOWN_TABLED_HUSH_MS : SHOWDOWN_HUSH_MS
  const steps: ShowdownStep[] = []
  order.forEach((seat, index) => {
    const mucked = !tabled && options.mucked?.has(seat) === true
    const deciding = order.length > 1 && index === order.length - 1
    if (deciding && !tabled) cursor += SHOWDOWN_TENSION_MS
    steps.push({
      seat,
      revealAtMs: cursor,
      secondCardAtMs: tabled ? cursor : cursor + SHOWDOWN_SECOND_CARD_MS,
      nameAtMs: cursor + (tabled ? SHOWDOWN_TABLED_NAME_MS : mucked ? 0 : SHOWDOWN_NAME_MS),
      deciding,
      mucked,
    })
    cursor += tabled ? SHOWDOWN_TABLED_STEP_MS : mucked ? SHOWDOWN_MUCK_MS : SHOWDOWN_STEP_MS
  })
  return { steps, awardAtMs: cursor, totalMs: cursor + SHOWDOWN_AWARD_HOLD_MS }
}

/**
 * How long a showdown takes to tell, for holding the next deal: this many hands shown and
 * this many thrown away, told as a tabled showdown or not. The length does not depend on
 * the order, so the server needs only the counts.
 */
export function showdownPresentationMs(
  shownHands: number,
  options: { mucked?: number; tabled?: boolean } = {},
): number {
  const mucked = options.mucked ?? 0
  const hands = shownHands + mucked
  if (hands <= 0) return 0
  const seats = Array.from({ length: hands }, (_, index) => index)
  return showdownShow(seats, {
    tabled: options.tabled === true,
    mucked: new Set(seats.slice(shownHands)),
  }).totalMs
}

/**
 * Who turns their hand over at a showdown, by the house rule: hands are shown in the
 * dealer's order, each one shows if it beats or ties the best already shown and is thrown
 * away unseen if it cannot, and a player who always shows does. When anybody is all in and
 * the betting is over, every hand is turned face up. The winner always shows: it beats or
 * ties every hand before it.
 */
export function showdownReveals(input: {
  order: readonly number[]
  ranks: ReadonlyMap<number, HandRank>
  /** Somebody is all in: every hand is tabled. */
  allIn: boolean
  /** Seats whose players show their hand whatever it is. */
  alwaysShow: ReadonlySet<number>
}): Set<number> {
  if (input.allIn) return new Set(input.order)
  const shown = new Set<number>()
  let best: HandRank | null = null
  for (const seat of input.order) {
    const rank = input.ranks.get(seat)
    if (rank === undefined) continue
    const beats = best === null || compareRanks(rank, best) >= 0
    if (beats || input.alwaysShow.has(seat)) shown.add(seat)
    if (beats) best = rank
  }
  return shown
}

/**
 * The order hands are turned over in, as a dealer calls it.
 *
 * The last player to bet or raise on the final round of betting shows first: they were
 * called, so they show. If nobody bet on that round, the first player still in the hand
 * to the left of the button shows first. Everyone else follows round the table in the
 * direction play passes, which on this table is from one seat number to the next.
 *
 * The final round is the last street anybody acted on, which is the river for a hand that
 * was played out, and an earlier street for one that ended in all-ins with the board still
 * to come.
 */
export function showdownOrder(input: {
  record: { actions: Readonly<HandRecord['actions']> }
  shownSeats: readonly number[]
  dealerSeat: number
  seatCount: number
}): number[] {
  const shown = new Set(input.shownSeats)
  if (shown.size === 0) return []
  const clockwiseFrom = (start: number): number[] => {
    const order: number[] = []
    for (let step = 0; step < input.seatCount; step += 1) {
      const seat = (((start + step) % input.seatCount) + input.seatCount) % input.seatCount
      if (shown.has(seat)) order.push(seat)
    }
    return order
  }
  const actions = input.record.actions
  const finalStreet = actions.length === 0 ? null : actions[actions.length - 1]?.street
  let aggressor: number | null = null
  for (const action of actions) {
    if (action.street !== finalStreet) continue
    if (action.action.kind === 'raiseTo' || action.action.kind === 'allIn') aggressor = action.seat
  }
  if (aggressor !== null && shown.has(aggressor)) return clockwiseFrom(aggressor)
  return clockwiseFrom(input.dealerSeat + 1)
}
