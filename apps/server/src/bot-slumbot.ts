import {
  type BotPersonality,
  type BotPolicy,
  type Card,
  cardKey,
  DEFAULT_STAKE,
  makeDeck,
  type StakeConfig,
  type TurnAction,
} from '@river/engine'
import { actionFor, botPlayerId } from './bot-service.js'
import { defaultRoomConfig, Room } from './room.js'

/** Slumbot's table: blinds of 50 and 100 and 20,000-chip stacks that reset every hand. */
export const SLUMBOT_STAKE: StakeConfig = {
  ...DEFAULT_STAKE,
  id: 'slumbot',
  label: '50/100',
  smallBlind: 50,
  bigBlind: 100,
  minBuyIn: 20_000,
  maxBuyIn: 20_000,
  defaultBuyIn: 20_000,
}

/** Where a Slumbot hand stands, as its API reports it. */
export interface SlumbotState {
  /** Slumbot's action string: streets split by `/`, `bN` a bet to N chips on that street. */
  readonly action: string
  /** 1 when we are the small blind, on the button; 0 when we are the big blind. */
  readonly clientPos: 0 | 1
  readonly hole: readonly Card[]
  readonly board: readonly Card[]
  /** Slumbot's cards, known only once the hand is over; used to replay it for analysis. */
  readonly theirHole?: readonly Card[]
}

export interface SlumbotMove {
  readonly street: number
  readonly action: TurnAction
}

/** The moves in a Slumbot action string, in order, as River table actions. */
export function slumbotMoves(action: string): SlumbotMove[] {
  const moves: SlumbotMove[] = []
  action.split('/').forEach((text, street) => {
    let index = 0
    while (index < text.length) {
      const code = text[index]
      if (code === 'k' || code === 'c' || code === 'f') {
        const kind = code === 'k' ? 'check' : code === 'c' ? 'call' : 'fold'
        moves.push({ street, action: { kind } })
        index += 1
        continue
      }
      if (code !== 'b') throw new Error(`unknown Slumbot action ${code} in ${action}`)
      let end = index + 1
      while (end < text.length && /[0-9]/.test(text[end] as string)) end += 1
      const to = Number(text.slice(index + 1, end))
      if (!Number.isSafeInteger(to) || to <= 0) throw new Error(`bad Slumbot bet in ${action}`)
      moves.push({ street, action: { kind: 'raiseTo', to } })
      index = end
    }
  })
  return moves
}

/**
 * A River room holding the hand as Slumbot has played it so far: our real
 * cards, the board revealed so far, and unused cards standing in for
 * Slumbot's hand and the cards still to come, which nothing reads. The button
 * sits in seat 0 and is dealt first, so it posts the small blind.
 */
export function slumbotRoom(
  state: SlumbotState,
  ids: { readonly ours: string; readonly theirs: string },
): Room {
  const known = new Set([...state.hole, ...state.board, ...(state.theirHole ?? [])].map(cardKey))
  const fillers = makeDeck().filter((card) => !known.has(cardKey(card)))
  const theirs = state.theirHole ?? fillers.slice(0, 2)
  const onButton = state.clientPos === 1
  const buttonHole = onButton ? state.hole : theirs
  const bigBlindHole = onButton ? theirs : state.hole
  const board = [...state.board, ...fillers.slice(state.theirHole === undefined ? 2 : 0)].slice(
    0,
    5,
  )
  const deck = [buttonHole[0], bigBlindHole[0], buttonHole[1], bigBlindHole[1], ...board] as Card[]
  const room = new Room(
    'slumbot',
    defaultRoomConfig({
      seed: 'slumbot',
      inviteCode: 'RIVER2',
      maxSeats: 2,
      seedCollectionMs: 0,
      stake: SLUMBOT_STAKE,
    }),
    deck,
  )
  const seating: [string, number][] = onButton
    ? [
        [ids.ours, 0],
        [ids.theirs, 1],
      ]
    : [
        [ids.theirs, 0],
        [ids.ours, 1],
      ]
  for (const [playerId, seat] of seating) {
    accepted(room.submit({ kind: 'join', playerId, name: playerId }))
    accepted(room.submit({ kind: 'sit', playerId, seat, buyIn: SLUMBOT_STAKE.defaultBuyIn }))
  }
  accepted(room.submit({ kind: 'startHand' }))
  for (const move of slumbotMoves(state.action)) {
    const actorId = room.viewFor('').currentActor?.playerId
    if (actorId === undefined)
      throw new Error(`Slumbot acted after the hand ended: ${state.action}`)
    const seat = room.viewFor(actorId).seats.find((entry) => entry.playerId === actorId)
    const allIn =
      move.action.kind === 'raiseTo' &&
      seat !== undefined &&
      move.action.to >= seat.stack + seat.betStreet
    const action: TurnAction = allIn ? { kind: 'allIn' } : move.action
    if (!room.submit({ kind: 'act', playerId: actorId, action }).ok) {
      throw new Error(`River refused ${JSON.stringify(move)} in ${state.action}`)
    }
  }
  return room
}

/** Our reply to Slumbot in its own notation, chosen by a River policy at the rebuilt table. */
export function slumbotIncrement(
  state: SlumbotState,
  policy: BotPolicy,
  personality: BotPersonality,
  rng: () => number,
): string {
  const ours = botPlayerId(personality.id)
  const room = slumbotRoom(state, { ours, theirs: botPlayerId('slumbot') })
  const view = room.viewFor(ours)
  const seat = view.seats.find((entry) => entry.playerId === ours)
  if (view.currentActor?.playerId !== ours || seat === undefined) {
    throw new Error(`not our turn after Slumbot's ${state.action}`)
  }
  const action = actionFor(view, ours, personality, rng, {
    policy,
    roomId: room.id,
    publicActions: room.currentActions(),
  })
  if (action === null) throw new Error(`no legal action after ${state.action}`)
  switch (action.kind) {
    case 'fold':
      return view.legal?.check.enabled === true ? 'k' : 'f'
    case 'check':
      return 'k'
    case 'call':
      return 'c'
    case 'raiseTo':
      return `b${action.to}`
    case 'allIn':
      return `b${seat.stack + seat.betStreet}`
  }
}

function accepted(result: { readonly ok: boolean }): void {
  if (!result.ok) throw new Error('Slumbot table setup was refused')
}
