import {
  BettingError,
  BettingHand,
  type BotObservationV1,
  type BotOpponentStatsV2,
  type BotOpponentSummaryV1,
  type BotTiltState,
  type HandAction,
  type PlayerState,
  type Street,
} from '@river/engine'
import { emptyOpponentSummary } from './bot-service.js'

/** One earlier decision of the hand: the acting seat's view at that moment, and the move it made. */
export interface PublicDecision {
  readonly observation: BotObservationV1
  readonly taken: HandAction
}

/** What only the acting seat itself knew at a decision: its reads and its tilt. */
export interface ReplayMemory {
  readonly opponents?: readonly BotOpponentSummaryV1[]
  readonly opponentStats?: readonly BotOpponentStatsV2[]
  readonly tilt?: BotTiltState
}

const BOARD_CARDS: Readonly<Record<Street, number>> = { preflop: 0, flop: 3, turn: 4, river: 5 }

/**
 * Rebuilds every earlier decision of the current hand from what anyone at the
 * table can see: the chips in front of each seat, the dealer button, the board
 * and the public action list. A seat started the hand with its stack plus what
 * it has put in, and its blind is what it put in beyond its recorded moves.
 * Each replayed move must commit exactly the chips the table recorded, and the
 * replay must arrive at the current decision, or nothing is returned.
 *
 * The rebuilt views carry no hole cards; a caller swaps in whichever holding
 * it is asking about. Reads and tilt, which only the acting seat knew, come
 * from `memoryFor`; without them a seat is a stranger with no tilt. It needs
 * every seat dealt in to have acted or posted a blind, which is always so by
 * the time a hand reaches the flop.
 */
export function publicDecisions(
  current: BotObservationV1,
  memoryFor: (playerId: string) => ReplayMemory = () => ({}),
): PublicDecision[] | null {
  const actions = current.actions
  if (actions === undefined || current.dealerSeat === undefined) return null
  const committed = new Map<number, number>()
  for (const entry of actions) {
    if (entry.amountCommitted === undefined) return null
    committed.set(entry.seat, (committed.get(entry.seat) ?? 0) + entry.amountCommitted)
  }
  const dealt = current.seats.filter(
    (seat): seat is typeof seat & { playerId: string } =>
      seat.playerId !== null && (seat.betHand > 0 || committed.has(seat.seat)),
  )
  if (dealt.length < 2) return null
  const found = dealt.findIndex((seat) => seat.seat === current.dealerSeat)
  const dealerIndex = found === -1 ? 0 : found
  const posted = dealt.map((seat) => seat.betHand - (committed.get(seat.seat) ?? 0))
  const smallIndex = dealt.length === 2 ? dealerIndex : (dealerIndex + 1) % dealt.length
  const bigIndex = (smallIndex + 1) % dealt.length
  const smallBlind = posted[smallIndex] as number
  const bigBlind = posted[bigIndex] as number
  if (
    smallBlind > bigBlind ||
    bigBlind <= 0 ||
    posted.some((amount, index) =>
      index === smallIndex || index === bigIndex ? amount < 0 : amount !== 0,
    )
  ) {
    return null
  }
  let hand: BettingHand
  try {
    hand = new BettingHand({
      seats: dealt.map((seat) => ({ id: seat.playerId, stack: seat.stack + seat.betHand })),
      dealerIndex,
      smallBlind,
      bigBlind,
    })
  } catch (error) {
    if (error instanceof BettingError) return null
    throw error
  }
  const decisions: PublicDecision[] = []
  for (let index = 0; index < actions.length; index += 1) {
    const entry = actions[index] as HandAction
    const seat = dealt.find((candidate) => candidate.seat === entry.seat)
    if (
      seat === undefined ||
      hand.finished ||
      hand.toActId !== seat.playerId ||
      hand.street !== entry.street ||
      (entry.potBefore !== undefined && entry.potBefore !== hand.pot())
    ) {
      return null
    }
    decisions.push({
      observation: viewAt(hand, current, seat, actions.slice(0, index), memoryFor(seat.playerId)),
      taken: entry,
    })
    const player = hand.players.find((candidate) => candidate.id === seat.playerId) as PlayerState
    const before = player.betThisHand
    try {
      apply(hand, seat.playerId, entry)
    } catch (error) {
      if (error instanceof BettingError) return null
      throw error
    }
    if (player.betThisHand - before !== entry.amountCommitted) return null
  }
  if (
    hand.finished ||
    hand.toActId !== current.actor.playerId ||
    hand.street !== current.street ||
    hand.pot() !== current.pot ||
    hand.currentBet !== current.currentBet
  ) {
    return null
  }
  return decisions
}

function apply(hand: BettingHand, playerId: string, entry: HandAction): void {
  const { action } = entry
  switch (action.kind) {
    case 'fold':
      hand.fold(playerId)
      return
    case 'check':
      hand.check(playerId)
      return
    case 'call':
      hand.call(playerId)
      return
    case 'raiseTo':
      hand.raiseTo(playerId, action.to)
      return
    case 'allIn':
      hand.allIn(playerId)
      return
  }
}

/** The acting seat's legal view, built the way the room and the bot service build it. */
function viewAt(
  hand: BettingHand,
  current: BotObservationV1,
  actor: { readonly seat: number; readonly playerId: string },
  prefix: readonly HandAction[],
  memory: ReplayMemory,
): BotObservationV1 {
  const players = new Map(hand.players.map((player) => [player.id, player]))
  const player = players.get(actor.playerId) as PlayerState
  const cost = hand.betToCall(actor.playerId)
  const raise = hand.minRaiseTo()
  const open = hand.canRaise(actor.playerId)
  const maxTo = player.stack + player.betThisStreet
  return {
    version: 1,
    roomId: current.roomId,
    handNumber: current.handNumber,
    actor: {
      playerId: actor.playerId,
      seat: actor.seat,
      hole: [],
      stack: player.stack,
      betHand: player.betThisHand,
      betStreet: player.betThisStreet,
    },
    street: hand.street,
    board: current.board.slice(0, BOARD_CARDS[hand.street]).map((card) => ({ ...card })),
    ...(current.dealerSeat === undefined ? {} : { dealerSeat: current.dealerSeat }),
    pot: hand.pot(),
    currentBet: hand.currentBet,
    amountToCall: Math.max(0, hand.currentBet - player.betThisStreet),
    legal: {
      fold: true,
      check: cost === 0,
      call: { enabled: cost > 0 && player.stack > 0, amount: Math.min(cost, player.stack) },
      raiseTo: { enabled: open && maxTo >= raise, min: raise, max: maxTo },
      allIn: { enabled: player.stack > 0 && (open || player.stack <= cost), amount: maxTo },
    },
    seats: current.seats.map((seat) => {
      const state = seat.playerId === null ? undefined : players.get(seat.playerId)
      return state === undefined
        ? { ...seat }
        : {
            seat: seat.seat,
            playerId: seat.playerId,
            stack: state.stack,
            betHand: state.betThisHand,
            betStreet: state.betThisStreet,
            folded: state.folded,
            allIn: state.allIn,
            away: seat.away,
          }
    }),
    opponents: current.seats
      .filter(
        (seat): seat is typeof seat & { playerId: string } =>
          seat.playerId !== null && seat.playerId !== actor.playerId,
      )
      .map((seat) => {
        const summary = memory.opponents?.find((entry) => entry.playerId === seat.playerId)
        return summary === undefined ? emptyOpponentSummary(seat.playerId) : { ...summary }
      }),
    ...(memory.opponentStats === undefined
      ? {}
      : { opponentStats: memory.opponentStats.map((stats) => structuredClone(stats)) }),
    actions: prefix.map((entry) => ({ ...entry, action: { ...entry.action } })),
    tilt: memory.tilt ?? { factor: 0 },
  }
}
