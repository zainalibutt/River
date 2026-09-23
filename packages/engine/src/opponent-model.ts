import type { HandRecord } from './hand-history.js'
import { isAggressiveHandAction } from './hand-history.js'

export interface OpponentModelTuning {
  readonly halfLifeMs: number
  readonly confidenceHands: number
  readonly priorWeight: number
  readonly priorVpip: number
  readonly priorPfr: number
  readonly priorAggression: number
  readonly priorShowdown: number
  readonly priorAggressivePotRatio: number
  readonly maxAggressivePotRatio: number
}

export interface OpponentHandEvidence {
  readonly vpip: boolean
  readonly pfr: boolean
  readonly aggressiveActions: number
  readonly passiveCalls: number
  readonly showdown: boolean
  readonly aggressivePotRatios: readonly number[]
}

export interface OpponentModelStateV1 {
  readonly version: 1
  readonly weightedHands: number
  readonly weightedVpip: number
  readonly weightedPfr: number
  readonly weightedAggressiveActions: number
  readonly weightedPassiveCalls: number
  readonly weightedShowdowns: number
  readonly weightedAggressivePotRatioTotal: number
  readonly weightedAggressivePotRatioSamples: number
  readonly lastSeenAtMs: number
}

export interface OpponentModelSummaryV1 {
  readonly version: 1
  readonly sampleCount: number
  readonly confidence: number
  readonly vpip: number
  readonly pfr: number
  readonly aggressionFrequency: number
  readonly showdownFrequency: number
  readonly averageAggressivePotRatio: number
}

export function opponentEvidenceFromHand(
  record: HandRecord,
  playerId: string,
  tuning: OpponentModelTuning,
): OpponentHandEvidence | null {
  const seat = record.seats.find((entry) => entry.playerId === playerId)?.seat
  if (seat === undefined) return null
  const highestByStreet = new Map<HandRecord['actions'][number]['street'], number>()
  let vpip = false
  let pfr = false
  let aggressiveActions = 0
  let passiveCalls = 0
  const aggressivePotRatios: number[] = []

  for (const entry of record.actions) {
    const priorHigh = highestByStreet.get(entry.street) ?? 0
    const aggressive = isAggressiveHandAction(entry, priorHigh)
    if (entry.seat === seat) {
      if (
        entry.street === 'preflop' &&
        (entry.action.kind === 'call' ||
          entry.action.kind === 'raiseTo' ||
          entry.action.kind === 'allIn')
      ) {
        vpip = true
      }
      if (entry.street === 'preflop' && aggressive) pfr = true
      if (aggressive) {
        aggressiveActions += 1
        if (
          entry.amountCommitted !== undefined &&
          entry.potBefore !== undefined &&
          entry.potBefore > 0
        ) {
          aggressivePotRatios.push(
            Math.min(tuning.maxAggressivePotRatio, entry.amountCommitted / entry.potBefore),
          )
        }
      } else if (entry.action.kind === 'call' || entry.action.kind === 'allIn') {
        passiveCalls += 1
      }
    }
    if (entry.streetBetAfter !== undefined) {
      highestByStreet.set(entry.street, Math.max(priorHigh, entry.streetBetAfter))
    }
  }

  return {
    vpip,
    pfr,
    aggressiveActions,
    passiveCalls,
    showdown: record.results.some((entry) => entry.seat === seat && entry.showed),
    aggressivePotRatios,
  }
}

export function updateOpponentModel(
  previous: OpponentModelStateV1 | null,
  evidence: OpponentHandEvidence,
  observedAtMs: number,
  tuning: OpponentModelTuning,
): OpponentModelStateV1 {
  const base = previous ?? emptyOpponentModel(observedAtMs)
  const elapsedMs = Math.max(0, observedAtMs - base.lastSeenAtMs)
  const decay = 2 ** (-elapsedMs / tuning.halfLifeMs)
  const ratioTotal = evidence.aggressivePotRatios.reduce((sum, ratio) => sum + ratio, 0)
  return {
    version: 1,
    weightedHands: base.weightedHands * decay + 1,
    weightedVpip: base.weightedVpip * decay + Number(evidence.vpip),
    weightedPfr: base.weightedPfr * decay + Number(evidence.pfr),
    weightedAggressiveActions: base.weightedAggressiveActions * decay + evidence.aggressiveActions,
    weightedPassiveCalls: base.weightedPassiveCalls * decay + evidence.passiveCalls,
    weightedShowdowns: base.weightedShowdowns * decay + Number(evidence.showdown),
    weightedAggressivePotRatioTotal: base.weightedAggressivePotRatioTotal * decay + ratioTotal,
    weightedAggressivePotRatioSamples:
      base.weightedAggressivePotRatioSamples * decay + evidence.aggressivePotRatios.length,
    lastSeenAtMs: Math.max(base.lastSeenAtMs, observedAtMs),
  }
}

export function summariseOpponentModel(
  state: OpponentModelStateV1,
  tuning: OpponentModelTuning,
): OpponentModelSummaryV1 {
  const smoothed = (value: number, opportunities: number, prior: number): number =>
    (value + prior * tuning.priorWeight) / (opportunities + tuning.priorWeight)
  const actionCount = state.weightedAggressiveActions + state.weightedPassiveCalls
  return {
    version: 1,
    sampleCount: state.weightedHands,
    confidence: clamp01(1 - Math.exp(-state.weightedHands / tuning.confidenceHands)),
    vpip: smoothed(state.weightedVpip, state.weightedHands, tuning.priorVpip),
    pfr: smoothed(state.weightedPfr, state.weightedHands, tuning.priorPfr),
    aggressionFrequency: smoothed(
      state.weightedAggressiveActions,
      actionCount,
      tuning.priorAggression,
    ),
    showdownFrequency: smoothed(state.weightedShowdowns, state.weightedHands, tuning.priorShowdown),
    averageAggressivePotRatio: smoothed(
      state.weightedAggressivePotRatioTotal,
      state.weightedAggressivePotRatioSamples,
      tuning.priorAggressivePotRatio,
    ),
  }
}

function emptyOpponentModel(atMs: number): OpponentModelStateV1 {
  return {
    version: 1,
    weightedHands: 0,
    weightedVpip: 0,
    weightedPfr: 0,
    weightedAggressiveActions: 0,
    weightedPassiveCalls: 0,
    weightedShowdowns: 0,
    weightedAggressivePotRatioTotal: 0,
    weightedAggressivePotRatioSamples: 0,
    lastSeenAtMs: atMs,
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
