import type { BotDecisionInput, BotPersonality, BotProfile, Rng, TurnAction } from '@river/engine'
import { decideBotTurn, pickPersonalities } from '@river/engine'
import type { RoomView } from './protocol.js'

/**
 * Bot player ids are prefixed rather than being UUIDs.
 *
 * Everything that touches real money keys on a Supabase player id, and a bot
 * has no account and no bankroll. A prefix nothing else can produce means a bot
 * can never be mistaken for a person by any code that reaches for the ledger.
 */
const BOT_PREFIX = 'bot:'

export function botPlayerId(personalityId: string): string {
  return `${BOT_PREFIX}${personalityId}`
}

export function isBotPlayer(playerId: string): boolean {
  return playerId.startsWith(BOT_PREFIX)
}

/**
 * How a character becomes a set of thresholds.
 *
 * A personality is written in the language of the table - tight, aggressive,
 * chatty - and the decision function wants numbers. Two of the floors are
 * compared against edge, which is strength minus pot odds and can be negative;
 * the other two are compared against raw strength between zero and one. Mixing
 * those up produces a bot that folds every hand, which reads as broken rather
 * than as cautious.
 */
export function profileFor(personality: BotPersonality): BotProfile {
  const tight = clamp01(personality.tightness)
  return {
    skill: personality.skill,
    label: personality.name,
    aggression: clamp01(personality.aggression),
    looseness: 1 - tight,
    bluffRate: clamp01(personality.bluffRate),
    // Compared against edge: a loose bot will call a slightly losing price.
    callFloor: -0.05 + tight * 0.15,
    rerollFloor: 0.18 + tight * 0.14,
    // Compared against strength.
    raiseFloor: 0.46 + tight * 0.22,
    allInFloor: 0.8 + tight * 0.14,
  }
}

/**
 * Which personalities fill a table, derived from the room so a reconnecting
 * player finds the same opponents rather than a fresh cast.
 */
export function botsForTable(roomId: string, count: number): readonly BotPersonality[] {
  return pickPersonalities(seedOf(roomId), Math.max(0, count))
}

/** Seats with nobody in them. A bot fills a seat, it does not create one. */
export function emptySeatsIn(view: RoomView): number[] {
  return view.seats.filter((seat) => seat.playerId === null).map((seat) => seat.seat)
}

export function humansIn(view: RoomView): number {
  return view.seats.filter((seat) => seat.playerId !== null && !isBotPlayer(seat.playerId)).length
}

export function botsIn(view: RoomView): string[] {
  return view.seats
    .map((seat) => seat.playerId)
    .filter((playerId): playerId is string => playerId !== null && isBotPlayer(playerId))
}

/**
 * How many bots a table should hold.
 *
 * Never more than the seats allow, and never so many that a room fills up
 * before people arrive - one seat is always left for the next person unless the
 * table is already busy with humans.
 */
export function botsWanted(view: RoomView, target: number): number {
  const humans = humansIn(view)
  if (humans === 0) return 0
  const seats = view.seats.length
  const reserved = humans < seats - 1 ? 1 : 0
  return Math.max(0, Math.min(target, seats - humans - reserved) - botsIn(view).length)
}

/**
 * The decision input for a bot whose turn it is.
 *
 * Returns null when the view does not show this player acting, or does not
 * carry their hole cards. A bot that cannot see its own cards must not guess.
 */
export function decisionInputFor(view: RoomView, playerId: string): BotDecisionInput | null {
  if (view.currentActor?.playerId !== playerId) return null
  const seat = view.seats.find((entry) => entry.playerId === playerId)
  if (seat === undefined || seat.hole === null || seat.hole.length === 0) return null
  const legal = view.legal
  if (legal === null) return null
  return {
    street: view.street,
    hole: seat.hole,
    board: view.board,
    betToCall: Math.max(0, view.currentBet - seat.betStreet),
    pot: view.pot,
    minRaiseTo: legal.raiseTo.min,
    currentBet: view.currentBet,
    stack: seat.stack,
    betThisStreet: seat.betStreet,
  }
}

/**
 * What a bot does on its turn, already reduced to something legal.
 *
 * The decision function does not know what the table will accept, so a raise it
 * cannot afford becomes an all-in and a check it is not owed becomes a fold.
 * Sending an illegal action would be refused and the bot would sit there until
 * the clock ran out, which reads as a frozen table.
 */
export function actionFor(
  view: RoomView,
  playerId: string,
  personality: BotPersonality,
  rng: Rng,
): TurnAction | null {
  const input = decisionInputFor(view, playerId)
  const legal = view.legal
  if (input === null || legal === null) return null

  const decision = decideBotTurn(input, profileFor(personality), rng)
  switch (decision.kind) {
    case 'check':
      return legal.check.enabled ? { kind: 'check' } : { kind: 'fold' }
    case 'call':
      if (legal.call.enabled) return { kind: 'call' }
      return legal.check.enabled ? { kind: 'check' } : { kind: 'fold' }
    case 'allIn':
      return legal.allIn.enabled ? { kind: 'allIn' } : fallback(legal)
    case 'raiseTo': {
      if (!legal.raiseTo.enabled) return fallback(legal)
      // The legal actions carry a minimum but no maximum, so the ceiling is
      // the seat's own chips. Asking for more than that is refused, and a
      // refused bot sits until the clock runs out.
      const seat = view.seats.find((entry) => entry.playerId === playerId)
      const ceiling = (seat?.stack ?? 0) + (seat?.betStreet ?? 0)
      const to = Math.min(Math.max(decision.to, legal.raiseTo.min), ceiling)
      if (to < legal.raiseTo.min) return legal.allIn.enabled ? { kind: 'allIn' } : fallback(legal)
      return { kind: 'raiseTo', to }
    }
    default:
      return { kind: 'fold' }
  }
}

function fallback(legal: NonNullable<RoomView['legal']>): TurnAction {
  if (legal.call.enabled) return { kind: 'call' }
  if (legal.check.enabled) return { kind: 'check' }
  return { kind: 'fold' }
}

/**
 * How long a bot appears to think.
 *
 * Instant answers are the clearest tell that a table is not real, and a
 * constant delay is the second clearest. Chattier characters take longer,
 * because they are the ones a player watches.
 */
export function thinkingMs(personality: BotPersonality, rng: Rng): number {
  const base = personality.chatter === 'constant' ? 1_400 : 900
  const spread = personality.chatter === 'silent' ? 700 : 1_600
  return Math.round(base + rng() * spread)
}

function seedOf(roomId: string): number {
  let value = 0
  for (const character of roomId) {
    value = (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0
  }
  return value
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
