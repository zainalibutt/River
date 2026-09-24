import {
  type BotOpponentSummaryV1,
  type BotPersonality,
  type BotPolicy,
  type Card,
  DEFAULT_OPPONENT_MODEL_TUNING,
  DEFAULT_STAKE,
  type HandRecord,
  mulberry32,
  type OpponentModelStateV1,
  opponentEvidenceFromHand,
  POSTFLOP_STREETS,
  publicEvidenceFromHand,
  rankValue,
  seedFromString,
  summariseOpponentModel,
  updateOpponentModel,
} from '@river/engine'
import { actionFor, type BotActionOptions, botPlayerId } from './bot-service.js'
import type { RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

export interface SessionEntrant {
  readonly personality: BotPersonality
  readonly policy?: BotPolicy
}

export interface SessionTableSpec {
  readonly name: string
  readonly style: string
  /** Entrant zero is the focal seat; its policy comes from the run, not from here. */
  readonly entrants: readonly SessionEntrant[]
}

export interface SettledSessionHand {
  readonly record: HandRecord
  /** Hole cards the table showed publicly, by player. Folded and mucked hands are absent. */
  readonly shown: ReadonlyMap<string, readonly Card[]>
  readonly atMs: number
}

/**
 * Extra public-only memory for the focal seat, such as a candidate's own read.
 *
 * It sees exactly what the room's opponent memory sees: settled hand records
 * and publicly shown cards. What it hands back is merged into the focal seat's
 * action options, so it reaches the policy through the ordinary observation.
 */
export interface FocalMemoryPlugin {
  observe(hand: SettledSessionHand, opponentIds: readonly string[]): void
  actionOptions(): Partial<BotActionOptions>
}

export interface SessionRunOptions {
  readonly seed: string
  readonly sessions: number
  readonly handsPerSession: number
  readonly table: SessionTableSpec
  readonly focalPolicy: BotPolicy
  /** Rotated across sessions so a result belongs to a skill, not one character. */
  readonly focalPersonalities?: readonly BotPersonality[]
  readonly plugin?: () => FocalMemoryPlugin
  readonly onFocalHand?: (session: number, hand: number) => void
}

export type PositionClass = 'button' | 'big-blind' | 'early' | 'middle' | 'late' | 'blinds'
export type DepthClass = 'short' | 'standard' | 'deep'
export type HandClass =
  | 'premium'
  | 'strong'
  | 'pair'
  | 'suited-playable'
  | 'offsuit-broadway'
  | 'weak'

export interface SessionHandResult {
  readonly session: number
  readonly hand: number
  readonly commit: string
  readonly focalChips: number
  readonly position: PositionClass
  readonly depth: DepthClass
  readonly handClass: HandClass
}

export interface OpponentEvidenceYield {
  readonly session: number
  readonly opponentId: string
  readonly hands: number
  readonly preflopFacedRaise: number
  readonly facedBet: Readonly<Record<(typeof POSTFLOP_STREETS)[number], number>>
  readonly checkedTo: Readonly<Record<(typeof POSTFLOP_STREETS)[number], number>>
  readonly showed: number
  readonly shownRiverAggression: number
}

export interface SessionRunResult {
  readonly hands: readonly SessionHandResult[]
  readonly evidence: readonly OpponentEvidenceYield[]
}

/**
 * The stack each seat buys in with, in big blinds, and how often.
 *
 * River's buy-in range is 100 to 400 big blinds with 200 the default; 40 stands
 * in for a seat that has lost chips during a session. These are evaluation
 * weights, not a measurement of real tables.
 */
export const SESSION_STACK_DEPTHS: readonly {
  readonly bigBlinds: number
  readonly weight: number
}[] = [
  { bigBlinds: 40, weight: 0.25 },
  { bigBlinds: 100, weight: 0.25 },
  { bigBlinds: 200, weight: 0.35 },
  { bigBlinds: 400, weight: 0.15 },
]
export const SESSION_DEPTH_LIMITS = { shortMaximum: 60, standardMaximum: 160 } as const
export const SESSION_HAND_INTERVAL_MS = 60_000
const MAX_ACTIONS_PER_HAND = 1_000

export function runSessions(options: SessionRunOptions): SessionRunResult {
  validate(options)
  const hands: SessionHandResult[] = []
  const evidence: OpponentEvidenceYield[] = []
  for (let session = 0; session < options.sessions; session += 1) {
    const entrants = entrantsFor(options, session)
    const ids = entrants.map((entrant) => botPlayerId(entrant.personality.id))
    const opponentIds = ids.slice(1)
    const memory = new Map<string, OpponentModelStateV1>()
    const plugin = options.plugin?.()
    const yields = new Map(opponentIds.map((id) => [id, emptyYield(session, id)]))
    for (let hand = 0; hand < options.handsPerSession; hand += 1) {
      options.onFocalHand?.(session, hand)
      const settled = playHand(options, session, hand, entrants, ids, {
        opponentSummaries: summaries(memory),
        ...(plugin?.actionOptions() ?? {}),
      })
      hands.push(settled.result)
      for (const opponentId of opponentIds) {
        const v1 = opponentEvidenceFromHand(
          settled.hand.record,
          opponentId,
          DEFAULT_OPPONENT_MODEL_TUNING,
        )
        if (v1 !== null) {
          memory.set(
            opponentId,
            updateOpponentModel(
              memory.get(opponentId) ?? null,
              v1,
              settled.hand.atMs,
              DEFAULT_OPPONENT_MODEL_TUNING,
            ),
          )
        }
        accumulateYield(yields.get(opponentId), settled.hand, opponentId)
      }
      plugin?.observe(settled.hand, opponentIds)
    }
    evidence.push(...yields.values())
  }
  return { hands, evidence }
}

function playHand(
  options: SessionRunOptions,
  session: number,
  hand: number,
  entrants: readonly SessionEntrant[],
  ids: readonly string[],
  focalOptions: Partial<BotActionOptions>,
): { result: SessionHandResult; hand: SettledSessionHand } {
  const key = `${options.seed}:${session}:${hand}`
  const deckRng = mulberry32(seedFromString(`${key}:deck`))
  const stackRng = mulberry32(seedFromString(`${key}:stacks`))
  const actionRngs = entrants.map((_, entrant) =>
    mulberry32(seedFromString(`${key}:action:${entrant}`)),
  )
  const seatCount = entrants.length
  const depths = SESSION_STACK_DEPTHS.map((depth) => depth.bigBlinds)
  const stake = {
    ...DEFAULT_STAKE,
    minBuyIn: Math.min(...depths) * DEFAULT_STAKE.bigBlind,
    maxBuyIn: Math.max(...depths) * DEFAULT_STAKE.bigBlind,
  }
  const room = new Room(
    `session-${session}-hand-${hand}`,
    defaultRoomConfig({
      seed: key,
      inviteCode: 'RIVER2',
      maxSeats: seatCount,
      seedCollectionMs: 0,
      nowMs: () => session * 1_000_000_000 + hand * SESSION_HAND_INTERVAL_MS,
      randomBytes: (size: number) =>
        Uint8Array.from({ length: size }, () => Math.floor(deckRng() * 256)),
      stake,
    }),
  )
  const chairOf = entrants.map((_, entrant) => (entrant + hand) % seatCount)
  const buyIns = entrants.map(() => drawDepth(stackRng) * DEFAULT_STAKE.bigBlind)
  const initialChips = buyIns.reduce((sum, value) => sum + value, 0)
  for (let entrant = 0; entrant < seatCount; entrant += 1) {
    const playerId = ids[entrant] as string
    const personality = entrants[entrant]?.personality as BotPersonality
    requireAccepted(room.submit({ kind: 'join', playerId, name: personality.name }))
    requireAccepted(
      room.submit({
        kind: 'sit',
        playerId,
        seat: chairOf[entrant] as number,
        buyIn: buyIns[entrant] as number,
      }),
    )
  }
  const started = room.submit({ kind: 'startHand' })
  requireAccepted(started)
  const commit = started.events.find((event) => event.kind === 'seedCommitted')
  if (commit?.kind !== 'seedCommitted') throw new Error('session hand commit missing')
  const focalId = ids[0] as string
  const opening = room.viewFor(focalId)
  const focalHole = opening.seats.find((seat) => seat.playerId === focalId)?.hole
  const dealerChair = opening.seats.find((seat) => seat.dealer)?.seat
  if (focalHole?.length !== 2 || dealerChair === undefined) {
    throw new Error('session hand opening missing')
  }

  for (let step = 0; step < MAX_ACTIONS_PER_HAND; step += 1) {
    const publicView = room.viewFor('')
    if (publicView.phase === 'between') {
      if (room.totalChips() !== initialChips) throw new Error('session chip conservation failed')
      const record = room.recentHands(1)[0]
      if (record === undefined) throw new Error('session hand record missing')
      const focalChair = chairOf[0] as number
      const focalFinal = publicView.seats.find((seat) => seat.seat === focalChair)
      if (focalFinal === undefined) throw new Error('session focal seat missing')
      const othersDepth = Math.max(...buyIns.slice(1))
      return {
        result: {
          session,
          hand,
          commit: commit.commit,
          focalChips: focalFinal.stack - (buyIns[0] as number),
          position: positionClass((focalChair - dealerChair + seatCount) % seatCount, seatCount),
          depth: depthClass(Math.min(buyIns[0] as number, othersDepth) / DEFAULT_STAKE.bigBlind),
          handClass: handClassOf(focalHole),
        },
        hand: {
          record,
          shown: shownHoles(publicView),
          atMs: session * 1_000_000_000 + hand * SESSION_HAND_INTERVAL_MS,
        },
      }
    }
    const actorId = publicView.currentActor?.playerId
    if (actorId === undefined) throw new Error('session hand has no actor')
    const entrant = ids.indexOf(actorId)
    const entry = entrants[entrant]
    const rng = actionRngs[entrant]
    if (entry === undefined || rng === undefined) throw new Error('session actor missing')
    const policy = entrant === 0 ? options.focalPolicy : entry.policy
    const action = actionFor(room.viewFor(actorId), actorId, entry.personality, rng, {
      ...(policy === undefined ? {} : { policy }),
      roomId: room.id,
      publicActions: room.currentActions(),
      ...(entrant === 0 ? focalOptions : {}),
    })
    if (action === null) throw new Error('session policy returned no legal action')
    requireAccepted(room.submit({ kind: 'act', playerId: actorId, action }))
  }
  throw new Error('session hand exceeded action limit')
}

export function positionClass(offsetFromDealer: number, seatCount: number): PositionClass {
  if (seatCount === 2) return offsetFromDealer === 0 ? 'button' : 'big-blind'
  if (offsetFromDealer === 1 || offsetFromDealer === 2) return 'blinds'
  if (offsetFromDealer === 0 || offsetFromDealer === seatCount - 1) return 'late'
  if (offsetFromDealer >= seatCount - 3) return 'middle'
  return 'early'
}

export function depthClass(effectiveBigBlinds: number): DepthClass {
  if (effectiveBigBlinds <= SESSION_DEPTH_LIMITS.shortMaximum) return 'short'
  return effectiveBigBlinds <= SESSION_DEPTH_LIMITS.standardMaximum ? 'standard' : 'deep'
}

export function handClassOf(hole: readonly Card[]): HandClass {
  const [first, second] = hole
  if (first === undefined || second === undefined) throw new Error('hand class needs two cards')
  const high = Math.max(rankValue(first.rank), rankValue(second.rank))
  const low = Math.min(rankValue(first.rank), rankValue(second.rank))
  const suited = first.suit === second.suit
  if (high === low) return high >= 12 ? 'premium' : high >= 10 ? 'strong' : 'pair'
  if (high === 14 && low === 13) return 'premium'
  if ((high === 14 && low === 12) || (suited && ((high === 14 && low === 11) || low === 12))) {
    return 'strong'
  }
  if (suited && (high === 14 || low >= 10 || (high - low <= 2 && low >= 4))) {
    return 'suited-playable'
  }
  return low >= 10 ? 'offsuit-broadway' : 'weak'
}

function entrantsFor(options: SessionRunOptions, session: number): readonly SessionEntrant[] {
  const rotation = options.focalPersonalities
  if (rotation === undefined || rotation.length === 0) return options.table.entrants
  const personality = rotation[session % rotation.length] as BotPersonality
  return [{ personality }, ...options.table.entrants.slice(1)]
}

function summaries(memory: ReadonlyMap<string, OpponentModelStateV1>): BotOpponentSummaryV1[] {
  return [...memory].map(([playerId, model]) => ({
    playerId,
    ...summariseOpponentModel(model, DEFAULT_OPPONENT_MODEL_TUNING),
  }))
}

function shownHoles(view: RoomView): Map<string, readonly Card[]> {
  const shown = new Map<string, readonly Card[]>()
  if (!view.revealed) return shown
  for (const seat of view.seats) {
    if (seat.playerId !== null && seat.hole !== null && seat.hole.length === 2) {
      shown.set(
        seat.playerId,
        seat.hole.map((card) => ({ ...card })),
      )
    }
  }
  return shown
}

function drawDepth(rng: () => number): number {
  const total = SESSION_STACK_DEPTHS.reduce((sum, depth) => sum + depth.weight, 0)
  let draw = rng() * total
  for (const depth of SESSION_STACK_DEPTHS) {
    if (draw < depth.weight) return depth.bigBlinds
    draw -= depth.weight
  }
  return (SESSION_STACK_DEPTHS.at(-1) as { bigBlinds: number }).bigBlinds
}

interface MutableYield {
  session: number
  opponentId: string
  hands: number
  preflopFacedRaise: number
  facedBet: Record<(typeof POSTFLOP_STREETS)[number], number>
  checkedTo: Record<(typeof POSTFLOP_STREETS)[number], number>
  showed: number
  shownRiverAggression: number
}

function emptyYield(session: number, opponentId: string): MutableYield {
  return {
    session,
    opponentId,
    hands: 0,
    preflopFacedRaise: 0,
    facedBet: { flop: 0, turn: 0, river: 0 },
    checkedTo: { flop: 0, turn: 0, river: 0 },
    showed: 0,
    shownRiverAggression: 0,
  }
}

function accumulateYield(
  target: MutableYield | undefined,
  hand: SettledSessionHand,
  opponentId: string,
): void {
  const evidence = publicEvidenceFromHand(
    hand.record,
    opponentId,
    hand.shown.get(opponentId) ?? null,
  )
  if (target === undefined || evidence === null) return
  target.hands += 1
  target.preflopFacedRaise += evidence.facedPreflopRaise
  for (const street of POSTFLOP_STREETS) {
    target.facedBet[street] += evidence.streets[street].facedBet
    target.checkedTo[street] += evidence.streets[street].checkedTo
  }
  if (evidence.showed) target.showed += 1
  if (evidence.shownRiverAggression !== null) target.shownRiverAggression += 1
}

function requireAccepted(result: { ok: boolean; events: readonly { kind: string }[] }): void {
  if (result.ok) return
  const rejected = result.events.find((event) => event.kind === 'rejected')
  throw new Error(`session command rejected (${rejected?.kind ?? 'unknown'})`)
}

function validate(options: SessionRunOptions): void {
  if (!Number.isSafeInteger(options.sessions) || options.sessions < 2) {
    throw new Error('session runs need at least two sessions for a clustered interval')
  }
  if (!Number.isSafeInteger(options.handsPerSession) || options.handsPerSession <= 0) {
    throw new Error('hands per session must be a positive safe integer')
  }
  const seats = options.table.entrants.length
  if (seats < 2 || seats > 9) throw new Error('session tables need two to nine seats')
  for (let session = 0; session < Math.min(options.sessions, 64); session += 1) {
    const ids = entrantsFor(options, session).map((entrant) => entrant.personality.id)
    if (new Set(ids).size !== ids.length) throw new Error('session personality ids must be unique')
  }
}
