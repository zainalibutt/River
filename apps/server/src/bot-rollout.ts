import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  mulberry32,
  seedFromString,
  type TurnAction,
} from '@river/engine'
import { botPlayerId } from './bot-service.js'
import { actOnce, type FocalDecisionPoint, openSessionHand } from './bot-session-benchmark.js'

/** The action buckets a learned model scores, in a fixed order per situation. */
export const FACING_BUCKETS = ['fold', 'call', 'raise'] as const
export const FREE_BUCKETS = ['check', 'bet-half', 'bet-pot'] as const
export type Situation = 'facing' | 'free'

export const ROLLOUT_TUNING = { raisePotRatio: 0.75, halfPot: 0.5, fullPot: 1 } as const

export function situationOf(observation: BotObservationV1): Situation {
  return observation.amountToCall > 0 ? 'facing' : 'free'
}

/** The legal action a bucket stands for, or null when the table does not allow it. */
export function bucketAction(observation: BotObservationV1, bucket: number): TurnAction | null {
  const { legal, amountToCall, pot, currentBet } = observation
  const raise = (target: number): TurnAction | null => {
    if (legal.raiseTo.enabled && legal.raiseTo.min <= legal.raiseTo.max) {
      return {
        kind: 'raiseTo',
        to: Math.min(legal.raiseTo.max, Math.max(legal.raiseTo.min, Math.round(target))),
      }
    }
    return legal.allIn.enabled ? { kind: 'allIn' } : null
  }
  if (amountToCall > 0) {
    if (bucket === 0) return legal.fold ? { kind: 'fold' } : null
    if (bucket === 1) {
      if (legal.call.enabled) return { kind: 'call' }
      return legal.allIn.enabled ? { kind: 'allIn' } : null
    }
    return raise(currentBet + (pot + amountToCall) * ROLLOUT_TUNING.raisePotRatio)
  }
  if (bucket === 0) return legal.check ? { kind: 'check' } : null
  if (bucket === 1) return raise(pot * ROLLOUT_TUNING.halfPot)
  return raise(pot * ROLLOUT_TUNING.fullPot)
}

/** Which bucket a policy's decision falls in, so a model and a rule can be compared. */
export function bucketOf(observation: BotObservationV1, decision: BotDecision): number {
  if (observation.amountToCall > 0) {
    if (decision.kind === 'fold' || decision.kind === 'check') return 0
    if (decision.kind === 'call') return 1
    return 2
  }
  if (decision.kind === 'raiseTo') {
    return decision.to <= observation.pot * ((ROLLOUT_TUNING.halfPot + ROLLOUT_TUNING.fullPot) / 2)
      ? 1
      : 2
  }
  return decision.kind === 'allIn' ? 2 : 0
}

/**
 * The focal seat's chip change from a decision point to the end of the hand,
 * after taking `first` there and letting every seat play on.
 *
 * The hand is reopened from its seed and the accepted prefix replayed, so the
 * cards are the real ones; this is an offline training label, and the
 * observation the model later sees still holds none of them. Only the seats'
 * later choices are redrawn, from `rolloutSeed`.
 */
export function rolloutValue(
  point: FocalDecisionPoint,
  first: TurnAction,
  focalPolicy: BotPolicy,
  rolloutSeed: string,
): number {
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
  for (const entry of point.prefix) {
    const playerId = idBySeat.get(entry.seat)
    if (
      playerId === undefined ||
      !room.submit({ kind: 'act', playerId, action: entry.action }).ok
    ) {
      throw new Error('rollout replay diverged')
    }
  }
  const focalId = ids[0] as string
  const view = room.viewFor(focalId)
  const stack = view.seats.find((seat) => seat.playerId === focalId)?.stack
  if (
    view.currentActor?.playerId !== focalId ||
    stack !== point.observation.actor.stack ||
    view.pot !== point.observation.pot
  ) {
    throw new Error('rollout replay diverged')
  }
  if (!room.submit({ kind: 'act', playerId: focalId, action: first }).ok) {
    throw new Error('rollout action refused')
  }
  const rngs = point.entrants.map((_, entrant) =>
    mulberry32(seedFromString(`${rolloutSeed}:${entrant}`)),
  )
  for (let step = 0; step < 1_000; step += 1) {
    const current = room.viewFor('')
    if (current.phase === 'between') {
      const final = current.seats.find((seat) => seat.playerId === focalId)?.stack
      if (final === undefined) throw new Error('rollout focal seat missing')
      return final - stack
    }
    actOnce(room, ids, point.entrants, rngs, focalPolicy, point.focalOptions)
  }
  throw new Error('rollout exceeded action limit')
}
