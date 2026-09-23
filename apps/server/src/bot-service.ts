import type {
  BotDecision,
  BotDecisionEnvelope,
  BotDecisionInput,
  BotObservationV1,
  BotOpponentSummaryV1,
  BotPersonality,
  BotPolicy,
  BotPolicyContextV1,
  BotProfile,
  BotTablePreset,
  BotTiltState,
  HandAction,
  Rng,
  Street,
  TurnAction,
} from '@river/engine'
import {
  blend,
  decisionInputFromObservation,
  deterministicRulePolicy,
  normalizeBotTilt,
  pickPersonalitiesForPreset,
} from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
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
export function botsForTable(
  roomId: string,
  count: number,
  preset: BotTablePreset = 'random',
): readonly BotPersonality[] {
  return pickPersonalitiesForPreset(seedOf(roomId), Math.max(0, count), preset)
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
  const observation = observationFor(view, playerId)
  return observation === null ? null : decisionInputFromObservation(observation)
}

export function observationFor(
  view: RoomView,
  playerId: string,
  tilt?: BotTiltState,
  roomId = 'local',
  publicActions?: readonly HandAction[] | null,
  opponentSummaries?: readonly BotOpponentSummaryV1[],
): BotObservationV1 | null {
  if (view.currentActor?.playerId !== playerId) return null
  const seat = view.seats.find((entry) => entry.playerId === playerId)
  if (seat === undefined || seat.hole === null || seat.hole.length === 0) return null
  const legal = view.legal
  if (legal === null) return null
  const dealerSeat = view.seats.find((entry) => entry.dealer)?.seat
  const allowedOpponentIds = new Set(
    view.seats
      .map((entry) => entry.playerId)
      .filter((opponentId): opponentId is string => opponentId !== null && opponentId !== playerId),
  )
  const summariesByPlayerId = new Map(
    (opponentSummaries ?? [])
      .filter((summary) => allowedOpponentIds.has(summary.playerId))
      .map((summary) => [summary.playerId, summary]),
  )
  return {
    version: 1,
    roomId,
    handNumber: view.handNumber,
    actor: {
      playerId,
      seat: seat.seat,
      hole: seat.hole.map((card) => ({ ...card })),
      stack: seat.stack,
      betHand: seat.betHand,
      betStreet: seat.betStreet,
    },
    street: view.street,
    board: view.board.map((card) => ({ ...card })),
    ...(dealerSeat === undefined ? {} : { dealerSeat }),
    pot: view.pot,
    currentBet: view.currentBet,
    amountToCall: Math.max(0, view.currentBet - seat.betStreet),
    legal: {
      fold: legal.fold.enabled,
      check: legal.check.enabled,
      call: { enabled: legal.call.enabled, amount: legal.call.amount ?? 0 },
      raiseTo: {
        enabled: legal.raiseTo.enabled,
        min: legal.raiseTo.min,
        max: seat.stack + seat.betStreet,
      },
      allIn: { enabled: legal.allIn.enabled, amount: legal.allIn.amount ?? 0 },
    },
    seats: view.seats.map((entry) => ({
      seat: entry.seat,
      playerId: entry.playerId,
      stack: entry.stack,
      betHand: entry.betHand,
      betStreet: entry.betStreet,
      folded: entry.folded,
      allIn: entry.allIn,
      away: entry.disconnected,
    })),
    opponents: view.seats
      .filter(
        (entry): entry is typeof entry & { playerId: string } =>
          entry.playerId !== null && entry.playerId !== playerId,
      )
      .map((entry) => {
        const summary = summariesByPlayerId.get(entry.playerId)
        return (
          (summary === undefined ? undefined : { ...summary }) ?? {
            version: 1,
            playerId: entry.playerId,
            sampleCount: 0,
            confidence: 0,
            vpip: 0,
            pfr: 0,
            aggressionFrequency: 0,
            showdownFrequency: 0,
            averageAggressivePotRatio: 0,
          }
        )
      }),
    ...(publicActions === undefined || publicActions === null
      ? {}
      : { actions: publicActions.map((entry) => ({ ...entry, action: { ...entry.action } })) }),
    tilt: normalizeBotTilt(tilt),
  }
}

export interface BotDecisionTrace {
  readonly roomId: string
  readonly handNumber: number
  readonly actorId: string
  readonly seat: number
  readonly policyId: string
  readonly policyVersion: number
  readonly observationVersion: 1
  readonly decision: BotDecision
  readonly finalAction: TurnAction
  readonly legalised: boolean
  readonly fallbackReason: BotDecisionEnvelope['fallbackReason']
  readonly decisionKey: string
}

export type BotDecisionTraceSink = (trace: BotDecisionTrace) => void

export interface BotTiltContext {
  readonly roomId: string
  readonly playerId: string
  readonly personality: BotPersonality
}

export type BotTiltSource = (context: BotTiltContext) => BotTiltState

export interface BotActionOptions {
  readonly policy?: BotPolicy
  readonly tilt?: BotTiltState
  readonly trace?: BotDecisionTraceSink
  readonly roomId?: string
  readonly decisionKey?: string
  readonly publicActions?: readonly HandAction[] | null
  readonly opponentSummaries?: readonly BotOpponentSummaryV1[]
}

/**
 * What a bot does on its turn, already reduced to something legal.
 *
 * The decision function does not know what the table will accept, so a raise it
 * cannot afford becomes an all-in and an unavailable choice becomes the safest
 * enabled action.
 * Sending an illegal action would be refused and the bot would sit there until
 * the clock ran out, which reads as a frozen table.
 */
export function actionFor(
  view: RoomView,
  playerId: string,
  personality: BotPersonality,
  rng: Rng,
  options: BotActionOptions = {},
): TurnAction | null {
  const observation = observationFor(
    view,
    playerId,
    options.tilt,
    options.roomId,
    options.publicActions,
    options.opponentSummaries,
  )
  const legal = view.legal
  const actorSeat = view.seats.find((entry) => entry.playerId === playerId)
  if (observation === null || legal === null || actorSeat === undefined) return null

  const tiltedPersonality = blend(personality, observation.tilt.factor)
  const context: BotPolicyContextV1 = {
    observation,
    profile: profileFor(tiltedPersonality),
    personality: tiltedPersonality,
    tilt: observation.tilt,
    rng,
  }
  const envelope = decideWithFallback(options.policy ?? pokerGuardPolicy, context)
  const action = legalise(envelope.decision, legal, actorSeat.stack, actorSeat.betStreet)
  if (action === null) return null
  emitTrace(options.trace, {
    roomId: options.roomId ?? 'local',
    handNumber: view.handNumber,
    actorId: playerId,
    seat: actorSeat.seat,
    policyId: envelope.policyId,
    policyVersion: envelope.policyVersion,
    observationVersion: 1,
    decision: envelope.decision,
    finalAction: action,
    legalised: !sameAction(envelope.decision, action),
    fallbackReason: envelope.fallbackReason,
    decisionKey:
      options.decisionKey ?? `${view.handNumber}:${view.street}:${playerId}:${view.currentBet}`,
  })
  return action
}

function decideWithFallback(policy: BotPolicy, context: BotPolicyContextV1): BotDecisionEnvelope {
  try {
    const envelope = policy.decide(context)
    if (isValidEnvelope(envelope, policy, context.observation.version)) return envelope
    return fallbackEnvelope(context, 'invalid_envelope')
  } catch {
    return fallbackEnvelope(context, 'policy_error')
  }
}

function fallbackEnvelope(
  context: BotPolicyContextV1,
  fallbackReason: BotDecisionEnvelope['fallbackReason'],
): BotDecisionEnvelope {
  try {
    return { ...deterministicRulePolicy.decide(context), fallbackReason }
  } catch {
    const legal = context.observation.legal
    const decision: BotDecision = legal.check
      ? { kind: 'check' }
      : legal.fold
        ? { kind: 'fold' }
        : legal.call.enabled
          ? { kind: 'call' }
          : { kind: 'allIn' }
    return {
      policyId: 'safe-legal',
      policyVersion: 1,
      observationVersion: context.observation.version,
      decision,
      fallbackReason,
    }
  }
}

function isValidEnvelope(
  value: unknown,
  policy: BotPolicy,
  observationVersion: 1,
): value is BotDecisionEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const envelope = value as Partial<BotDecisionEnvelope>
  if (
    envelope.policyId !== policy.id ||
    envelope.policyVersion !== policy.version ||
    envelope.observationVersion !== observationVersion
  ) {
    return false
  }
  if (!isDecision(envelope.decision)) return false
  return (
    envelope.fallbackReason === null ||
    envelope.fallbackReason === 'policy_error' ||
    envelope.fallbackReason === 'invalid_envelope' ||
    envelope.fallbackReason === 'unsupported_observation'
  )
}

function isDecision(value: unknown): value is BotDecision {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false
  if (
    value.kind === 'fold' ||
    value.kind === 'check' ||
    value.kind === 'call' ||
    value.kind === 'allIn'
  ) {
    return true
  }
  return (
    value.kind === 'raiseTo' &&
    'to' in value &&
    typeof value.to === 'number' &&
    Number.isSafeInteger(value.to)
  )
}

function legalise(
  decision: BotDecision,
  legal: NonNullable<RoomView['legal']>,
  stack: number,
  betStreet: number,
): TurnAction | null {
  switch (decision.kind) {
    case 'check':
      return legal.check.enabled ? { kind: 'check' } : fallback(legal)
    case 'fold':
      return legal.fold.enabled ? { kind: 'fold' } : fallback(legal)
    case 'call':
      if (legal.call.enabled) return { kind: 'call' }
      return fallback(legal)
    case 'allIn':
      return legal.allIn.enabled ? { kind: 'allIn' } : fallback(legal)
    case 'raiseTo': {
      if (!legal.raiseTo.enabled) return fallback(legal)
      // The legal actions carry a minimum but no maximum, so the ceiling is
      // the seat's own chips. Asking for more than that is refused, and a
      // refused bot sits until the clock runs out.
      const ceiling = stack + betStreet
      const to = Math.min(Math.max(decision.to, legal.raiseTo.min), ceiling)
      if (to < legal.raiseTo.min) return legal.allIn.enabled ? { kind: 'allIn' } : fallback(legal)
      return { kind: 'raiseTo', to }
    }
  }
}

function fallback(legal: NonNullable<RoomView['legal']>): TurnAction | null {
  if (legal.check.enabled) return { kind: 'check' }
  if (legal.fold.enabled) return { kind: 'fold' }
  if (legal.call.enabled) return { kind: 'call' }
  if (legal.allIn.enabled) return { kind: 'allIn' }
  return null
}

function sameAction(decision: BotDecision, action: TurnAction): boolean {
  return (
    decision.kind === action.kind &&
    (decision.kind !== 'raiseTo' || (action.kind === 'raiseTo' && decision.to === action.to))
  )
}

function emitTrace(sink: BotDecisionTraceSink | undefined, trace: BotDecisionTrace): void {
  if (sink === undefined) return
  try {
    sink(trace)
  } catch {
    return
  }
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
