import type { RoomEvent, RoomView } from '@river/server'
import { CLIP_FPS } from './animation'
import { ALL_IN_SHOVE_TRACK, CHIP_PUSH_TRACK, travelProgress } from './seat-props'

/**
 * Where a table's chips go, as moments the scene can animate.
 *
 * The table drew each player's stack and nothing else, so a bet was an action pin over a
 * head and a number in the corner while the chips stayed where they were - a player pushed
 * his hand forward and nothing on the felt moved. Chips now travel: out of a stack to the
 * bet line when they are put in, from the bet line to the middle when a street ends, and
 * from the middle to whoever wins it.
 *
 * The view says where the chips are, not how they got there, and it does not always say
 * even that. A call that closes a betting round never appears as a bet at all: the round
 * ends in the same message, and the next street's bets start from zero. So what a seat put
 * in is read from its total for the hand, which only ever grows, and at the end of a hand,
 * when the view has already paid the pot out and cleared every bet, from the hand's record.
 *
 * Pure: the scene hands it views and a clock, and draws what it returns.
 */

/** Where a pile of chips is: a seat's stack, a seat's bet line, or the pot in the middle. */
export type PileKind = 'stack' | 'bet' | 'pot'

export interface Pile {
  kind: PileKind
  /** The seat for a stack or a bet line; null for the pot. */
  seat: number | null
}

/**
 * How a flight moves. A commit rides the hand that pushes it, on the frames the authored
 * stack moves on; a sweep or a payout slides across the felt on its own.
 */
export type FlightPath = 'push' | 'shove' | 'slide'

export interface ChipFlight {
  from: Pile
  to: Pile
  amount: number
  /** Seconds on the scene clock. */
  startAt: number
  landAt: number
  path: FlightPath
}

/** One message's worth of chip movement, worked out from the views either side of it. */
export interface ChipMoment {
  /** Where this sits in the table's running order; the scene applies each once. */
  serial: number
  handNumber: number
  /** Chips each seat put in during this message, and whose hand carries them. */
  commits: readonly { seat: number; amount: number; path: 'push' | 'shove' }[]
  /** Whether everything on the bet lines goes to the middle: a street ended, or the hand did. */
  sweep: boolean
  /** The middle paid out to its winners. */
  awards: readonly { seat: number; amount: number }[]
  /** What the view says is on each bet line and in the middle once all of that has happened. */
  truth: { bets: readonly { seat: number; amount: number }[]; pot: number }
}

/**
 * What moved between two views, given the events that moved it.
 *
 * `previous` is null for the first view a client sees - a page load or a reconnect - which
 * moves nothing and only says where things are.
 */
export function chipMomentFor(
  previous: RoomView | null,
  next: RoomView,
  events: readonly RoomEvent[],
  serial: number,
): ChipMoment {
  const truth = truthOf(next)
  const quiet: ChipMoment = {
    serial,
    handNumber: next.handNumber,
    commits: [],
    sweep: false,
    awards: [],
    truth,
  }
  if (previous === null) return quiet

  const shoved = new Set<number>()
  const seatOf = new Map<string, number>()
  for (const seat of [...previous.seats, ...next.seats]) {
    if (seat.playerId !== null) seatOf.set(seat.playerId, seat.seat)
  }
  for (const event of events) {
    if (event.kind === 'acted' && event.action.kind === 'allIn') {
      const seat = seatOf.get(event.playerId)
      if (seat !== undefined) shoved.add(seat)
    }
  }
  const path = (seat: number): 'push' | 'shove' => (shoved.has(seat) ? 'shove' : 'push')

  const awards: { seat: number; amount: number }[] = []
  for (const event of events) {
    if (event.kind === 'showdown') {
      for (const award of event.awards) {
        const seat = seatOf.get(award.playerId)
        if (seat !== undefined && award.amount > 0) awards.push({ seat, amount: award.amount })
      }
    }
    if (event.kind === 'uncontested') {
      const seat = seatOf.get(event.playerId)
      if (seat !== undefined && event.amount > 0) awards.push({ seat, amount: event.amount })
    }
  }

  const sameHand = previous.handNumber === next.handNumber
  const commits: { seat: number; amount: number; path: 'push' | 'shove' }[] = []

  if (next.phase === 'hand') {
    // During a hand the total each seat has put in only grows, so the growth is what went
    // in, including the call that closed a round and never showed as a bet.
    for (const seat of next.seats) {
      const before = sameHand
        ? (previous.seats.find((entry) => entry.seat === seat.seat)?.betHand ?? 0)
        : 0
      const amount = seat.betHand - before
      if (amount > 0) commits.push({ seat: seat.seat, amount, path: path(seat.seat) })
    }
    const sweep = sameHand && previous.phase === 'hand' && next.street !== previous.street
    return { ...quiet, commits, sweep, awards }
  }

  if (sameHand && previous.phase === 'hand') {
    // The hand ended in this message, and the view has already emptied every bet and the
    // pot. The record says what each seat won or lost; with the payouts, that is what each
    // put in, and less what was already in before this message is what this message added.
    const record = events.find((event) => event.kind === 'handRecorded')
    if (record?.kind === 'handRecorded') {
      const won = new Map<number, number>()
      for (const award of awards) won.set(award.seat, (won.get(award.seat) ?? 0) + award.amount)
      for (const result of record.record.results) {
        const putIn = (won.get(result.seat) ?? 0) - result.delta
        const before = previous.seats.find((entry) => entry.seat === result.seat)?.betHand ?? 0
        const amount = putIn - before
        if (amount > 0) commits.push({ seat: result.seat, amount, path: path(result.seat) })
      }
    }
    return { ...quiet, commits, sweep: true, awards }
  }

  return { ...quiet, awards }
}

function truthOf(view: RoomView): ChipMoment['truth'] {
  if (view.phase !== 'hand') return { bets: [], pot: 0 }
  const bets = view.seats
    .filter((seat) => seat.betStreet > 0)
    .map((seat) => ({ seat: seat.seat, amount: seat.betStreet }))
  const onLines = bets.reduce((total, bet) => total + bet.amount, 0)
  return { bets, pot: Math.max(0, view.pot - onLines) }
}

/**
 * The last frame a commit's chips move on, plus one: when they are down on the line. The
 * push also carries a folded hand's cards, so the scene reads the same number.
 */
export const COMMIT_PUSH_SECONDS = trackSeconds(CHIP_PUSH_TRACK)
const PUSH_SECONDS = COMMIT_PUSH_SECONDS
const SHOVE_SECONDS = trackSeconds(ALL_IN_SHOVE_TRACK)
/** A beat after the last chip lands before the dealer sweeps, and the sweep itself. */
const SWEEP_PAUSE_SECONDS = 0.15
export const SWEEP_SECONDS = 0.45
/** The pot goes to the winner after a beat, a little slower: it is the moment of the hand. */
const AWARD_PAUSE_SECONDS = 0.35
export const AWARD_SECONDS = 0.7

function trackSeconds(track: readonly number[]): number {
  const frames = track.length / 3 - 1
  let last = 0
  for (let frame = 1; frame <= frames; frame += 1) {
    if (travelProgress(track, frame) > travelProgress(track, frame - 1)) last = frame
  }
  return (last + 1) / CLIP_FPS
}

/** Every flight in progress, and the piles as they stood before the first of them. */
export interface ChipFlow {
  /** What was on each bet line and in the middle before any flight still in the list. */
  base: { bets: Map<number, number>; pot: number }
  flights: ChipFlight[]
  /** The newest moment applied, so a running list is read once. */
  lastSerial: number
  /** Where the view says the chips are, to settle on when everything has landed. */
  truth: ChipMoment['truth'] | null
}

export function emptyChipFlow(): ChipFlow {
  return { base: { bets: new Map(), pot: 0 }, flights: [], lastSerial: 0, truth: null }
}

/**
 * Schedule a moment's flights from `now`.
 *
 * A sweep waits for the moment's commits to land, and a payout for the sweep: chips put
 * in with the call that ends a hand go to the line, then the middle, then the winner, in
 * that order, rather than all flying at once.
 */
export function applyMoment(flow: ChipFlow, moment: ChipMoment, now: number): ChipFlow {
  if (moment.serial <= flow.lastSerial) return flow
  const flights = [...flow.flights]
  let committed = now
  for (const commit of moment.commits) {
    const seconds = commit.path === 'shove' ? SHOVE_SECONDS : PUSH_SECONDS
    flights.push({
      from: { kind: 'stack', seat: commit.seat },
      to: { kind: 'bet', seat: commit.seat },
      amount: commit.amount,
      startAt: now,
      landAt: now + seconds,
      path: commit.path,
    })
    committed = Math.max(committed, now + seconds)
  }
  let swept = committed
  if (moment.sweep) {
    const startAt = committed + (moment.commits.length > 0 ? SWEEP_PAUSE_SECONDS : 0)
    // Everything that will be on each line once the flights already in the air land.
    const settled = { ...flow, flights }
    for (const [seat, amount] of betsAfterAll(settled)) {
      if (amount <= 0) continue
      flights.push({
        from: { kind: 'bet', seat },
        to: { kind: 'pot', seat: null },
        amount,
        startAt,
        landAt: startAt + SWEEP_SECONDS,
        path: 'slide',
      })
      swept = Math.max(swept, startAt + SWEEP_SECONDS)
    }
  }
  const awardAt = swept + (moment.awards.length > 0 && swept > now ? AWARD_PAUSE_SECONDS : 0)
  for (const award of moment.awards) {
    flights.push({
      from: { kind: 'pot', seat: null },
      to: { kind: 'stack', seat: award.seat },
      amount: award.amount,
      startAt: awardAt,
      landAt: awardAt + AWARD_SECONDS,
      path: 'slide',
    })
  }
  return { base: flow.base, flights, lastSerial: moment.serial, truth: moment.truth }
}

/**
 * Fold every landed flight into the base, and once nothing is in the air, settle on what
 * the view says. Drift is possible - a reconnect, a message the client never saw - and a
 * pile that is wrong for good is worse than one that corrects itself between moves.
 */
export function settleChipFlow(flow: ChipFlow, now: number): ChipFlow {
  if (flow.flights.length === 0) {
    if (flow.truth === null) return flow
    const bets = new Map(flow.truth.bets.map((bet) => [bet.seat, bet.amount]))
    if (sameBets(bets, flow.base.bets) && flow.base.pot === flow.truth.pot) return flow
    return { ...flow, base: { bets, pot: flow.truth.pot } }
  }
  if (flow.flights.some((flight) => flight.landAt > now)) return flow
  const bets = betsAt(flow, Number.POSITIVE_INFINITY)
  const pot = potAt(flow, Number.POSITIVE_INFINITY)
  return settleChipFlow({ ...flow, base: { bets, pot }, flights: [] }, now)
}

function sameBets(left: Map<number, number>, right: Map<number, number>): boolean {
  if (left.size !== right.size) return false
  for (const [seat, amount] of left) if (right.get(seat) !== amount) return false
  return true
}

function betsAfterAll(flow: ChipFlow): Map<number, number> {
  return betsAt(flow, Number.POSITIVE_INFINITY)
}

/** What sits on each bet line at `now`: landed arrivals in, departed chips out. */
export function betsAt(flow: ChipFlow, now: number): Map<number, number> {
  const bets = new Map(flow.base.bets)
  for (const flight of flow.flights) {
    if (flight.to.kind === 'bet' && flight.to.seat !== null && flight.landAt <= now) {
      bets.set(flight.to.seat, (bets.get(flight.to.seat) ?? 0) + flight.amount)
    }
    if (flight.from.kind === 'bet' && flight.from.seat !== null && flight.startAt <= now) {
      bets.set(flight.from.seat, (bets.get(flight.from.seat) ?? 0) - flight.amount)
    }
  }
  for (const [seat, amount] of bets) if (amount <= 0) bets.delete(seat)
  return bets
}

/** What sits in the middle at `now`. */
export function potAt(flow: ChipFlow, now: number): number {
  let pot = flow.base.pot
  for (const flight of flow.flights) {
    if (flight.to.kind === 'pot' && flight.landAt <= now) pot += flight.amount
    if (flight.from.kind === 'pot' && flight.startAt <= now) pot -= flight.amount
  }
  return Math.max(0, pot)
}

/**
 * How much of a seat's stack, as the view gives it, is still on its way there or has not
 * left yet. The view pays a winner the moment the hand ends; the stack should grow when the
 * pot arrives, not before it sets off.
 */
export function stackAdjustmentAt(flow: ChipFlow, seat: number, now: number): number {
  let adjustment = 0
  for (const flight of flow.flights) {
    if (flight.to.kind === 'stack' && flight.to.seat === seat && flight.landAt > now) {
      adjustment -= flight.amount
    }
    // A bet stays in the stack until the hand reaches it: a second pile on top of the
    // stack for the frames before the push begins would read as chips appearing.
    if (
      flight.from.kind === 'stack' &&
      flight.from.seat === seat &&
      flightProgress(flight, now) <= 0
    ) {
      adjustment += flight.amount
    }
  }
  return adjustment
}

/** How far along its path a flight is at `now`, from 0 to 1. */
export function flightProgress(flight: ChipFlight, now: number): number {
  if (now <= flight.startAt) return 0
  if (now >= flight.landAt) return 1
  if (flight.path === 'push' || flight.path === 'shove') {
    const track = flight.path === 'shove' ? ALL_IN_SHOVE_TRACK : CHIP_PUSH_TRACK
    return travelProgress(track, (now - flight.startAt) * CLIP_FPS)
  }
  const t = (now - flight.startAt) / (flight.landAt - flight.startAt)
  // Eased both ends: a stack is pushed off, slides, and settles.
  return t * t * (3 - 2 * t)
}

/** Flights visibly between piles at `now`: set off, and not yet down. */
export function flightsAt(flow: ChipFlow, now: number): ChipFlight[] {
  return flow.flights.filter((flight) => flight.landAt > now && flightProgress(flight, now) > 0)
}
