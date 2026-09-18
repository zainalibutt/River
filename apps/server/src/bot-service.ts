import type {
  BotDecisionInput,
  BotPersonality,
  BotProfile,
  Rng,
  Street,
  TurnAction,
} from '@river/engine'
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

/** What a bot is deciding, as far as how long it should take to decide it. */
export interface ThinkingSituation {
  action: TurnAction['kind']
  street: Street
  betToCall: number
  pot: number
  /** The first decision of the hand is also the first look at the cards. */
  firstLook: boolean
}

export function situationFor(
  view: RoomView,
  playerId: string,
  action: TurnAction,
  firstLook: boolean,
): ThinkingSituation {
  const seat = view.seats.find((entry) => entry.playerId === playerId)
  return {
    action: action.kind,
    street: view.street,
    betToCall: Math.max(0, view.currentBet - (seat?.betStreet ?? 0)),
    pot: view.pot,
    firstLook,
  }
}

/**
 * The range each kind of decision takes, in milliseconds, before pressure.
 *
 * The first version of this gave every bot 0.9 to 3 seconds whatever it was deciding, which
 * is variation without tempo: measured on a live table, five bots in a row answered 1.0 to
 * 2.8 seconds apart, and a snap fold took exactly as long as calling a river shove. That
 * reads as a machine with a random delay - a player called it instant - because the tell a
 * person gives is not how long they take but how that changes with what is in front of them.
 */
const THINK_RANGE: Readonly<Record<TurnAction['kind'], readonly [number, number]>> = {
  fold: [650, 1_600],
  check: [700, 1_900],
  call: [1_300, 3_000],
  raiseTo: [1_900, 4_200],
  allIn: [2_800, 6_500],
}
/** A decision this big is sometimes agonised over. */
const TANK_CHANCE = 0.12
const TANK_MS: readonly [number, number] = [2_500, 5_500]
const THINK_FLOOR_MS = 600
const THINK_CEILING_MS = 11_000

/**
 * How long a bot appears to think.
 *
 * Instant answers are the clearest tell that a table is not real, and a
 * constant delay is the second clearest. So the time follows the decision: a
 * preflop fold with nothing invested is quick, a check is quick, calling is
 * slower, raising slower still, and a price that is a large share of the pot
 * slows everything down - and now and then a big one gets tanked on. The river
 * is weighed longer than the flop, the first decision of a hand includes a look
 * at the cards, and chattier characters take longer, because they are the ones
 * a player watches.
 */
export function thinkingMs(
  personality: BotPersonality,
  situation: ThinkingSituation,
  rng: Rng,
): number {
  const [low, high] = THINK_RANGE[situation.action]
  let ms = low + rng() * (high - low)
  // A fold after the flop has something in it to let go of, and is considered.
  if (situation.action === 'fold' && situation.street !== 'preflop') ms += 900
  const pressure = situation.pot > 0 ? Math.min(1.5, situation.betToCall / situation.pot) : 0
  if (situation.action !== 'check') ms += pressure * 1_800
  const big = situation.action === 'allIn' || pressure >= 0.5
  if (big && rng() < TANK_CHANCE) ms += TANK_MS[0] + rng() * (TANK_MS[1] - TANK_MS[0])
  if (situation.street === 'river') ms *= 1.15
  if (situation.firstLook) ms += 500
  if (personality.chatter === 'constant') ms *= 1.12
  if (personality.chatter === 'silent') ms *= 0.88
  return Math.round(Math.min(THINK_CEILING_MS, Math.max(THINK_FLOOR_MS, ms)))
}

/**
 * Whether a bot looks at its cards as soon as they land, and after how long.
 *
 * Most players do; some leave them on the felt until the action reaches them.
 * Everyone lifting their cards on the same beat reads as a drill.
 */
export function peekAfterDealMs(rng: Rng): number | null {
  if (rng() >= 0.65) return null
  return Math.round(400 + rng() * 2_200)
}

/**
 * When, inside its think, a bot looks at its cards - or null for not at all.
 *
 * A bot that has not looked yet always does, early on. After that it checks
 * again now and then, and more often facing a bet worth thinking about: players
 * re-read their cards before paying, rarely before checking. Only inside a
 * think long enough to finish the look before the action lands.
 */
export function peekDuringThinkMs(
  situation: ThinkingSituation,
  thinkMs: number,
  rng: Rng,
): number | null {
  if (situation.firstLook) return Math.round(thinkMs * (0.12 + rng() * 0.18))
  if (thinkMs < 2_200) return null
  const pressure = situation.pot > 0 ? situation.betToCall / situation.pot : 0
  const chance = situation.betToCall <= 0 ? 0.12 : pressure >= 0.5 ? 0.45 : 0.3
  if (rng() >= chance) return null
  return Math.round(thinkMs * (0.15 + rng() * 0.2))
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
