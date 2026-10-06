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
