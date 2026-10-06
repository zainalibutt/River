import {
  type BotObservationV1,
  type BotPersonality,
  type BotPolicy,
  DEFAULT_STAKE,
  mulberry32,
  SEATS_PER_SHAPE,
  seedFromString,
  type TurnAction,
} from '@river/engine'
import { actionFor, botPlayerId, observationFor } from './bot-service.js'
import type { RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

export interface BenchmarkSeat {
  readonly personality: BotPersonality
  readonly policy?: BotPolicy
}

export interface BenchmarkOptions {
  readonly seed: string
  readonly hands: number
  readonly seats: readonly BenchmarkSeat[]
  readonly onDecision?: (decision: BenchmarkDecision) => void
  readonly onHandComplete?: (hand: BenchmarkCompletedHand) => void
}

export interface BenchmarkCompletedHand {
  readonly handIndex: number
  readonly view: RoomView
}

export interface BenchmarkDecision {
  readonly handIndex: number
  readonly actorId: string
  readonly observation: BotObservationV1
  readonly action: TurnAction
}

export interface BenchmarkHand {
  readonly handIndex: number
  readonly commit: string
  readonly chairByEntrant: readonly number[]
  readonly netChips: readonly number[]
  readonly actions: readonly number[]
}

export interface BenchmarkResult {
  readonly seed: string
  readonly hands: number
  readonly seatCount: number
  readonly bigBlind: number
  readonly results: readonly BenchmarkHand[]
  readonly seats: readonly {
    readonly personalityId: string
    readonly policyId: string
    readonly netChips: number
    readonly bbPer100Hands: number
    readonly actions: number
  }[]
}

export interface PairedBenchmarkOptions {
  readonly seed: string
  readonly hands: number
  readonly seats: readonly Omit<BenchmarkSeat, 'policy'>[]
  readonly baseline: BotPolicy
  readonly candidate: BotPolicy
  readonly focalEntrant: number
}

export interface PairedBenchmarkResult {
  readonly seed: string
  readonly hands: number
  readonly focalEntrant: number
  readonly baseline: BenchmarkResult
  readonly candidate: BenchmarkResult
  readonly pairs: readonly {
    readonly handIndex: number
    readonly commit: string
    readonly baselineNetChips: number
    readonly candidateNetChips: number
    readonly deltaChips: number
  }[]
  readonly delta: {
    readonly meanChips: number
    readonly meanBigBlinds: number
    readonly bbPer100Hands: number
    readonly standardErrorChips: number
    readonly confidence95Chips: readonly [number, number]
    readonly wins: number
    readonly losses: number
    readonly ties: number
  }
}

const MAX_ACTIONS_PER_HAND = 1_000

export function runBotBenchmark(options: BenchmarkOptions): BenchmarkResult {
  validate(options)
  const results: BenchmarkHand[] = []
  const totals = options.seats.map(() => ({ netChips: 0, actions: 0 }))

  for (let handIndex = 0; handIndex < options.hands; handIndex += 1) {
    const hand = runHand(options, handIndex)
    results.push(hand)
    for (let seat = 0; seat < options.seats.length; seat += 1) {
      const total = totals[seat]
      if (total === undefined) throw new Error('benchmark total missing')
      total.netChips += hand.netChips[seat] ?? 0
      total.actions += hand.actions[seat] ?? 0
    }
  }

  return {
    seed: options.seed,
    hands: options.hands,
    seatCount: options.seats.length,
    bigBlind: DEFAULT_STAKE.bigBlind,
    results,
    seats: options.seats.map((seat, index) => ({
      personalityId: seat.personality.id,
      policyId: seat.policy?.id ?? 'deterministic-rule',
      netChips: totals[index]?.netChips ?? 0,
      bbPer100Hands:
        ((totals[index]?.netChips ?? 0) / DEFAULT_STAKE.bigBlind / options.hands) * 100,
      actions: totals[index]?.actions ?? 0,
    })),
  }
}

export function runPairedBotBenchmark(options: PairedBenchmarkOptions): PairedBenchmarkResult {
  validatePaired(options)
  const baseline = runBotBenchmark({
    seed: options.seed,
    hands: options.hands,
    seats: options.seats.map((seat) => ({ ...seat, policy: options.baseline })),
  })
  const candidate = runBotBenchmark({
    seed: options.seed,
    hands: options.hands,
    seats: options.seats.map((seat, entrant) => ({
      ...seat,
      policy: entrant === options.focalEntrant ? options.candidate : options.baseline,
    })),
  })
  const pairs = baseline.results.map((baselineHand, handIndex) => {
    const candidateHand = candidate.results[handIndex]
    if (candidateHand === undefined || candidateHand.commit !== baselineHand.commit) {
      throw new Error('paired benchmark deck mismatch')
    }
    const baselineNetChips = baselineHand.netChips[options.focalEntrant]
    const candidateNetChips = candidateHand.netChips[options.focalEntrant]
    if (baselineNetChips === undefined || candidateNetChips === undefined) {
      throw new Error('paired benchmark focal result missing')
    }
    return {
      handIndex,
      commit: baselineHand.commit,
      baselineNetChips,
      candidateNetChips,
      deltaChips: candidateNetChips - baselineNetChips,
    }
  })
  const deltas = pairs.map((pair) => pair.deltaChips)
  const meanChips = average(deltas)
  const standardErrorChips = standardError(deltas, meanChips)
  const confidenceRadius = 1.96 * standardErrorChips

  return {
    seed: options.seed,
    hands: options.hands,
    focalEntrant: options.focalEntrant,
    baseline,
    candidate,
    pairs,
    delta: {
      meanChips,
      meanBigBlinds: meanChips / DEFAULT_STAKE.bigBlind,
      bbPer100Hands: (meanChips / DEFAULT_STAKE.bigBlind) * 100,
      standardErrorChips,
      confidence95Chips: [meanChips - confidenceRadius, meanChips + confidenceRadius],
      wins: deltas.filter((delta) => delta > 0).length,
      losses: deltas.filter((delta) => delta < 0).length,
      ties: deltas.filter((delta) => delta === 0).length,
    },
  }
}

function runHand(options: BenchmarkOptions, handIndex: number): BenchmarkHand {
  const deckRng = mulberry32(seedFromString(`${options.seed}:${handIndex}:deck`))
  const actionRngs = options.seats.map((_, seat) =>
    mulberry32(seedFromString(`${options.seed}:${handIndex}:action:${seat}`)),
  )
  const randomBytes = (size: number): Uint8Array =>
    Uint8Array.from({ length: size }, () => Math.floor(deckRng() * 256))
  const room = new Room(
    `benchmark-${handIndex}`,
    defaultRoomConfig({
      seed: `${options.seed}:${handIndex}`,
      inviteCode: 'RIVER2',
      maxSeats: options.seats.length,
      seedCollectionMs: 0,
      nowMs: () => 0,
      randomBytes,
    }),
  )
  const buyIn = DEFAULT_STAKE.defaultBuyIn
  const initialChips = buyIn * options.seats.length
  const playerIds = options.seats.map((seat) => botPlayerId(seat.personality.id))
  const chairForEntrant = options.seats.map(
    (_, entrant) => (entrant + handIndex) % options.seats.length,
  )
  for (let entrant = 0; entrant < options.seats.length; entrant += 1) {
    const playerId = playerIds[entrant]
    const entry = options.seats[entrant]
    const chair = chairForEntrant[entrant]
    if (playerId === undefined || entry === undefined || chair === undefined) {
      throw new Error('benchmark seat missing')
    }
    requireAccepted(room.submit({ kind: 'join', playerId, name: entry.personality.name }))
    requireAccepted(room.submit({ kind: 'sit', playerId, seat: chair, buyIn }))
  }

  const started = room.submit({ kind: 'startHand' })
  requireAccepted(started)
  const commit = started.events.find((event) => event.kind === 'seedCommitted')
  if (commit?.kind !== 'seedCommitted') throw new Error('benchmark commit missing')
  const actions = options.seats.map(() => 0)
  for (let step = 0; step < MAX_ACTIONS_PER_HAND; step += 1) {
    const publicView = room.viewFor('')
    if (publicView.phase === 'between') {
      if (room.totalChips() !== initialChips) throw new Error('benchmark chip conservation failed')
      const finalView = room.viewFor('')
      const result = {
        handIndex,
        commit: commit.commit,
        chairByEntrant: chairForEntrant,
        netChips: chairForEntrant.map((chair) => {
          const seat = finalView.seats.find((entry) => entry.seat === chair)
          if (seat === undefined) throw new Error('benchmark result seat missing')
          return seat.stack - buyIn
        }),
        actions,
      }
      options.onHandComplete?.({ handIndex, view: finalView })
      return result
    }
    const actorId = publicView.currentActor?.playerId
    if (actorId === undefined) throw new Error('benchmark hand has no actor')
    const seat = playerIds.indexOf(actorId)
    const entry = options.seats[seat]
    const rng = actionRngs[seat]
    if (entry === undefined || rng === undefined) throw new Error('benchmark actor missing')
    const privateView = room.viewFor(actorId)
    const publicActions = room.currentActions()
    const observation =
      options.onDecision === undefined
        ? null
        : observationFor(privateView, actorId, undefined, room.id, publicActions)
    if (options.onDecision !== undefined && observation === null) {
      throw new Error('benchmark decision observation missing')
    }
    const action = actionFor(privateView, actorId, entry.personality, rng, {
      ...(entry.policy === undefined ? {} : { policy: entry.policy }),
      roomId: room.id,
      publicActions,
    })
    if (action === null) throw new Error('benchmark policy returned no legal action')
    const acted = room.submit({ kind: 'act', playerId: actorId, action })
    requireAccepted(acted, action)
    if (observation !== null) {
      options.onDecision?.({ handIndex, actorId, observation, action })
    }
    actions[seat] = (actions[seat] ?? 0) + 1
    if (room.totalChips() !== initialChips) throw new Error('benchmark chip conservation failed')
  }
  throw new Error('benchmark hand exceeded action limit')
}

function requireAccepted(
  result: { ok: boolean; events: readonly { kind: string }[] },
  action?: TurnAction,
): void {
  if (result.ok) return
  const reason = result.events.find((event) => event.kind === 'rejected')
  throw new Error(
    `benchmark command rejected: ${action?.kind ?? 'setup'} (${reason?.kind ?? 'unknown'})`,
  )
}

function validate(options: BenchmarkOptions): void {
  if (!Number.isSafeInteger(options.hands) || options.hands <= 0) {
    throw new Error('benchmark hands must be a positive safe integer')
  }
  if (options.seats.length < 2 || options.seats.length > SEATS_PER_SHAPE.full) {
    throw new Error(`benchmark needs two to ${SEATS_PER_SHAPE.full} seats`)
  }
  if (new Set(options.seats.map((seat) => seat.personality.id)).size !== options.seats.length) {
    throw new Error('benchmark personality ids must be unique')
  }
}

function validatePaired(options: PairedBenchmarkOptions): void {
  validate(options)
  if (!Number.isSafeInteger(options.focalEntrant) || options.focalEntrant < 0) {
    throw new Error('paired benchmark focal entrant must be a table index')
  }
  if (options.focalEntrant >= options.seats.length) {
    throw new Error('paired benchmark focal entrant must be seated')
  }
  if (options.hands < 2) {
    throw new Error('paired benchmark needs at least two hands')
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardError(values: readonly number[], mean: number): number {
  const squaredDistance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  const sampleVariance = squaredDistance / (values.length - 1)
  return Math.sqrt(sampleVariance / values.length)
}
