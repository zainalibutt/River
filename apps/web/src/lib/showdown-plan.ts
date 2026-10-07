import { type Card, type ShowdownShow, showdownOrder, showdownShow } from '@river/engine'
import type { RoomEvent, RoomView } from '@river/server'
import { readoutFor } from './hand-readout'

/**
 * A showdown ready to be told: who shows in what order, what each shows and what it makes,
 * and who takes the pot. Worked out once, from the message that ends the hand, and played
 * against the engine's schedule - see showdownShow.
 */
export interface ShowdownPlan {
  show: ShowdownShow
  cards: ReadonlyMap<number, readonly Card[]>
  names: ReadonlyMap<number, string>
  awards: readonly { seat: number; amount: number }[]
  pot: number
}

/**
 * The plan for a message that ends a hand at a showdown, or null for any other message.
 *
 * `folded` is who folded during the hand: once a hand is over the view reads every seat as
 * not folded, and only the hands that went to the showdown are turned over.
 */
export function showdownPlanFor(
  view: RoomView,
  events: readonly RoomEvent[],
  folded: ReadonlySet<number>,
): ShowdownPlan | null {
  const showdown = events.find((event) => event.kind === 'showdown')
  const recorded = events.find((event) => event.kind === 'handRecorded')
  if (showdown?.kind !== 'showdown' || recorded?.kind !== 'handRecorded' || !view.revealed) {
    return null
  }
  const shown = view.seats.filter(
    (seat) => seat.hole !== null && seat.hole.length === 2 && !folded.has(seat.seat),
  )
  if (shown.length === 0) return null
  const order = showdownOrder({
    record: recorded.record,
    shownSeats: shown.map((seat) => seat.seat),
    dealerSeat: view.seats.find((seat) => seat.dealer)?.seat ?? 0,
    seatCount: view.seats.length,
  })
  const seatOf = new Map(view.seats.map((seat) => [seat.playerId, seat.seat]))
  // The server awards pot by pot, so a player who takes the main pot and a side pot is
  // named twice. The table hears one total per winner.
  const won = new Map<number, number>()
  for (const award of showdown.awards) {
    const seat = seatOf.get(award.playerId)
    if (seat === undefined || award.amount <= 0) continue
    won.set(seat, (won.get(seat) ?? 0) + award.amount)
  }
  const awards = [...won].map(([seat, amount]) => ({ seat, amount }))
  return {
    show: showdownShow(order),
    cards: new Map(shown.map((seat) => [seat.seat, seat.hole ?? []])),
    names: new Map(
      shown.map((seat) => [seat.seat, readoutFor(seat.hole ?? [], view.board)?.full ?? '']),
    ),
    awards,
    pot: awards.reduce((total, award) => total + award.amount, 0),
  }
}

/** How many of a seat's cards are face up `atMs` into the showdown: none, one or both. */
export function cardsTurned(plan: ShowdownPlan, seat: number, atMs: number): number {
  const step = plan.show.steps.find((entry) => entry.seat === seat)
  if (step === undefined) return 0
  if (atMs >= step.secondCardAtMs) return 2
  return atMs >= step.revealAtMs ? 1 : 0
}

/**
 * The table as it stood before the pot was paid: every winner's stack without what the
 * showdown gave them, and nobody who showed a hand out yet. The message that ends a hand
 * already carries the settled stacks, so until the showdown reaches its award a stack that
 * had grown, or a seat marked out, would tell the table who won before the board was turned.
 *
 * The felt holds a winner's stack back itself, until the chips paid to it land, so it asks
 * for the seats only; a plain readout of a stack asks for both.
 */
export function beforeAwards(
  view: RoomView,
  plan: ShowdownPlan,
  { stacks }: { stacks: boolean },
): RoomView {
  return {
    ...view,
    // The pot is still in the middle until it is paid, whatever the settled view says.
    pot: Math.max(view.pot, plan.pot),
    seats: view.seats.map((seat) => {
      const won = !stacks
        ? 0
        : plan.awards
            .filter((award) => award.seat === seat.seat)
            .reduce((total, award) => total + award.amount, 0)
      // A hand that lost everything is out, and sitting out, only once the pot is paid.
      const showed = plan.cards.has(seat.seat)
      return won === 0 && !(showed && seat.busted)
        ? seat
        : {
            ...seat,
            stack: seat.stack - won,
            busted: showed ? false : seat.busted,
            sittingOut: showed ? false : seat.sittingOut,
          }
    }),
  }
}
