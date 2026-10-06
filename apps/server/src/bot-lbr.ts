import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  type Card,
  cardKey,
  handScore,
  makeDeck,
  mulberry32,
  seedFromString,
  type TurnAction,
} from '@river/engine'
import {
  candidateHoldings,
  moveFrequency,
  recordedClass,
  updateRange,
  type WeightedHolding,
} from './bot-lbr-range.js'
import { botPlayerId, observationFor } from './bot-service.js'
import { type FocalDecisionPoint, openSessionHand } from './bot-session-benchmark.js'

export const LBR_TUNING = { equitySamples: 6 } as const

interface HandState {
  readonly roomId: string
  readonly points: FocalDecisionPoint[]
  range: WeightedHolding[] | null
  applied: number
}

interface Option {
  readonly decision: BotDecision
  readonly value: number
  readonly foldShare?: number
}

/** What the probe chose at one decision, for tallying where its winnings come from. */
export interface ProbeChoice {
  readonly street: BotObservationV1['street']
  readonly kind: BotDecision['kind']
  readonly equity: number
  /** The share of the focal range expected to fold, when the choice was a bet or raise. */
  readonly foldShare?: number
}

/**
 * A heads-up local best response to a known focal policy.
 *
 * It never sees the focal seat's cards. It keeps a weighted range over the
 * focal's possible holdings, reweighted after each focal move by how often the
 * focal policy makes that move with each holding. Before the flop it only
 * folds or calls; after it, it also weighs a pot-sized bet or raise and an
 * all-in, asking the focal policy how often each holding folds to them. Every
 * option is valued as if both players only checked or called afterwards.
 * Whatever it wins is a lower bound on how exploitable the focal policy is.
 */
export function localBestResponse(
  focal: BotPolicy,
  options: { readonly onChoice?: (choice: ProbeChoice) => void } = {},
): {
  readonly policy: BotPolicy
  readonly watch: (point: FocalDecisionPoint) => void
} {
  let hand: HandState = { roomId: '', points: [], range: null, applied: 0 }
  const handFor = (roomId: string): HandState => {
    if (hand.roomId !== roomId) hand = { roomId, points: [], range: null, applied: 0 }
    return hand
  }
  const policy: BotPolicy = {
    id: 'local-best-response',
    version: 1,
    decide(context) {
      const { observation } = context
      const choice = bestResponse(focal, handFor(observation.roomId), observation)
      options.onChoice?.({
        street: observation.street,
        kind: choice.decision.kind,
        equity: choice.equity,
        ...(choice.foldShare === undefined ? {} : { foldShare: choice.foldShare }),
      })
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: observation.version,
        decision: choice.decision,
        fallbackReason: null,
      }
    },
  }
  return { policy, watch: (point) => handFor(point.observation.roomId).points.push(point) }
}

function bestResponse(
  focal: BotPolicy,
  hand: HandState,
  observation: BotObservationV1,
): Option & { readonly equity: number } {
  const range = rangeFor(focal, hand, observation)
  const random = mulberry32(
    seedFromString(`${observation.roomId}:${observation.actions?.length ?? 0}:equity`),
  )
  const wins = range.map((holding) =>
    holding.weight === 0 ? 0 : winShare(observation, holding.hole, random),
  )
  const winning = weightedShare(range, wins, () => 1)
  const { pot, amountToCall, legal, actor } = observation
  const options: Option[] = []
  if (amountToCall > 0) {
    const paid = Math.min(amountToCall, actor.stack)
    const uncalled = amountToCall - paid
    options.push({ decision: { kind: 'fold' }, value: 0 })
    options.push({ decision: { kind: 'call' }, value: winning * (pot + paid - uncalled) - paid })
  } else {
    options.push({ decision: { kind: 'check' }, value: winning * pot })
  }
  const point = hand.points[0]
  if (observation.street !== 'preflop' && point !== undefined) {
    for (const action of aggressiveOptions(observation)) {
      const valued = aggressiveValue(focal, point, observation, range, wins, action)
      if (valued !== null) options.push({ decision: action, ...valued })
    }
  }
  let best = options[0] as Option
  for (const option of options) if (option.value > best.value) best = option
  if (best.decision.kind === 'fold' && !legal.fold) {
    return { decision: { kind: 'check' }, value: 0, equity: winning }
  }
  return { ...best, equity: winning }
}

/** The focal range for this hand, brought up to date with every focal move so far. */
function rangeFor(
  focal: BotPolicy,
  hand: HandState,
  observation: BotObservationV1,
): WeightedHolding[] {
  const range =
    hand.range ??
    candidateHoldings(
      [...observation.actor.hole, ...observation.board],
      `${observation.roomId}:range`,
    )
  hand.range = range
  const personality = hand.points[0]?.entrants[0]?.personality
  while (personality !== undefined && hand.applied < hand.points.length) {
    const point = hand.points[hand.applied] as FocalDecisionPoint
    const taken = observation.actions?.[point.prefix.length]
    if (taken === undefined) break
    updateRange(
      range,
      focal,
      personality,
      point.observation,
      recordedClass(taken, point.observation),
      `${observation.roomId}:${point.prefix.length}:move`,
    )
    hand.applied += 1
  }
  const board = new Set(observation.board.map(cardKey))
  for (const holding of range) {
    if (board.has(cardKey(holding.hole[0])) || board.has(cardKey(holding.hole[1]))) {
      holding.weight = 0
    }
  }
  return range
}

/** A pot-sized bet or raise, and an all-in, where the table allows them. */
function aggressiveOptions(observation: BotObservationV1): TurnAction[] {
  const { legal, currentBet, pot, amountToCall } = observation
  const options: TurnAction[] = []
  const potSized = currentBet + pot + amountToCall
  if (
    legal.raiseTo.enabled &&
    legal.raiseTo.min <= legal.raiseTo.max &&
    potSized < legal.raiseTo.max
  ) {
    options.push({ kind: 'raiseTo', to: Math.max(legal.raiseTo.min, potSized) })
  }
  if (legal.allIn.enabled && observation.actor.stack > amountToCall) options.push({ kind: 'allIn' })
  return options
}

/**
 * The expected chips of a bet or raise: the pot now when the focal range
 * folds, and the showdown share against the holdings that do not when it
 * calls. A focal raise is treated as a call, as local best response does.
 */
function aggressiveValue(
  focal: BotPolicy,
  point: FocalDecisionPoint,
  observation: BotObservationV1,
  range: readonly WeightedHolding[],
  wins: readonly number[],
  action: TurnAction,
): { readonly value: number; readonly foldShare: number } | null {
  const facing = focalViewAfter(point, observation, action)
  const personality = point.entrants[0]?.personality
  if (facing === null || personality === undefined) return null
  const seed = `${observation.roomId}:${observation.actions?.length ?? 0}:${action.kind}:fold`
  const folds = range.map((holding) =>
    holding.weight === 0
      ? 0
      : moveFrequency(focal, personality, facing, holding.hole, 'fold', seed),
  )
  const total = range.reduce((sum, holding) => sum + holding.weight, 0)
  if (total === 0) return null
  const foldShare =
    range.reduce((sum, holding, index) => sum + holding.weight * (folds[index] as number), 0) /
    total
  const winning = weightedShare(range, wins, (index) => 1 - (folds[index] as number))
  const added = facing.pot - observation.pot
  const paid = Math.min(facing.amountToCall, facing.actor.stack)
  const uncalled = facing.amountToCall - paid
  const called = winning * (facing.pot + paid - uncalled) - (added - uncalled)
  return { value: foldShare * observation.pot + (1 - foldShare) * called, foldShare }
}

/**
 * The focal seat's legal view after the probe takes `action`, found by
 * reopening the hand from its seed and replaying the public actions. The view
 * carries the focal seat's real cards, but only as the frame each candidate
 * holding is swapped into; nothing reads them.
 */
function focalViewAfter(
  point: FocalDecisionPoint,
  observation: BotObservationV1,
  action: TurnAction,
): BotObservationV1 | null {
  const ids = point.entrants.map((entrant) => botPlayerId(entrant.personality.id))
  const { room } = openSessionHand(
    point.seed,
    point.session,
    point.hand,
    point.startMs,
    point.entrants,
    ids,
  )
  const idBySeat = new Map(
    room
      .viewFor('')
      .seats.filter((seat) => seat.playerId !== null)
      .map((seat) => [seat.seat, seat.playerId as string]),
  )
  for (const entry of observation.actions ?? []) {
    const playerId = idBySeat.get(entry.seat)
    if (
      playerId === undefined ||
      !room.submit({ kind: 'act', playerId, action: entry.action }).ok
    ) {
      throw new Error('best response replay diverged')
    }
  }
  const actorId = observation.actor.playerId
  const view = room.viewFor(actorId)
  if (view.currentActor?.playerId !== actorId || view.pot !== observation.pot) {
    throw new Error('best response replay diverged')
  }
  if (!room.submit({ kind: 'act', playerId: actorId, action }).ok) return null
  const focalId = ids[0] as string
  return observationFor(
    room.viewFor(focalId),
    focalId,
    undefined,
    room.id,
    room.currentActions(),
    point.focalOptions.opponentSummaries,
    point.focalOptions.opponentStats,
  )
}

/** The probe's showdown share against one holding, over random boards to come. */
function winShare(
  observation: BotObservationV1,
  hole: readonly [Card, Card],
  random: () => number,
): number {
  const board = observation.board
  const mine = observation.actor.hole
  const taken = new Set([...mine, ...board, ...hole].map(cardKey))
  const deck = makeDeck().filter((card) => !taken.has(cardKey(card)))
  const samples = board.length === 5 ? 1 : LBR_TUNING.equitySamples
  let won = 0
  for (let sample = 0; sample < samples; sample += 1) {
    const pool = [...deck]
    const completed: Card[] = [...board]
    while (completed.length < 5) {
      completed.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as Card)
    }
    const ours = handScore([...mine, ...completed])
    const theirs = handScore([...hole, ...completed])
    won += ours > theirs ? 1 : ours === theirs ? 0.5 : 0
  }
  return won / samples
}

/** The range-weighted mean of `values`, each holding's weight scaled by `scale`. */
function weightedShare(
  range: readonly WeightedHolding[],
  values: readonly number[],
  scale: (index: number) => number,
): number {
  let weight = 0
  let sum = 0
  range.forEach((holding, index) => {
    const w = holding.weight * scale(index)
    weight += w
    sum += w * (values[index] as number)
  })
  return weight === 0 ? 0.5 : sum / weight
}

function knownCase(id: string, facing: 'fold' | 'call'): BotPolicy {
  return {
    id,
    version: 1,
    decide(context) {
      const { observation } = context
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: observation.version,
        decision: observation.legal.check ? { kind: 'check' } : { kind: facing },
        fallbackReason: null,
      }
    },
  }
}

/** Known cases for the probe: a seat that never folds, and one that never puts a chip in. */
export const alwaysCallPolicy = knownCase('always-call', 'call')
export const alwaysFoldPolicy = knownCase('always-fold', 'fold')
