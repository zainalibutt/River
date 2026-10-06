import { type BotPolicy, DEFAULT_STAKE, POSTFLOP_STREETS } from '@river/engine'
import {
  type FocalMemoryPlugin,
  type OpponentEvidenceYield,
  runSessions,
  type SessionHandResult,
  type SessionRunOptions,
} from './bot-session-benchmark.js'

export interface PairedSessionOptions
  extends Omit<SessionRunOptions, 'focalPolicy' | 'plugin' | 'onFocalHand'> {
  readonly baseline: BotPolicy
  readonly candidate: BotPolicy
  readonly baselinePlugin?: () => FocalMemoryPlugin
  readonly candidatePlugin?: () => FocalMemoryPlugin
  readonly onCandidateHand?: (session: number, hand: number) => void
}

export interface SessionPair extends SessionHandResult {
  readonly baselineChips: number
  readonly candidateChips: number
  readonly deltaChips: number
}

export interface PairedSessionResult {
  readonly sessions: number
  readonly pairs: readonly SessionPair[]
  readonly evidence: readonly OpponentEvidenceYield[]
}

/**
 * The same sessions played twice, once with each focal policy.
 *
 * Decks, seats, stacks and every other seat's random stream are identical, so
 * a hand only differs where the focal policy chose differently or where that
 * choice changed what the others saw. Hands inside a session share the focal
 * seat's memory, which is why intervals are clustered by session, not by hand.
 */
export function runPairedSessions(options: PairedSessionOptions): PairedSessionResult {
  const { baseline, candidate, baselinePlugin, candidatePlugin, onCandidateHand, ...common } =
    options
  const baselineRun = runSessions({
    ...common,
    focalPolicy: baseline,
    ...(baselinePlugin === undefined ? {} : { plugin: baselinePlugin }),
  })
  const candidateRun = runSessions({
    ...common,
    focalPolicy: candidate,
    ...(candidatePlugin === undefined ? {} : { plugin: candidatePlugin }),
    ...(onCandidateHand === undefined ? {} : { onFocalHand: onCandidateHand }),
  })
  return {
    sessions: options.sessions,
    pairs: pairRuns(baselineRun.hands, candidateRun.hands),
    evidence: baselineRun.evidence,
  }
}

export function pairRuns(
  baseline: readonly SessionHandResult[],
  candidate: readonly SessionHandResult[],
): SessionPair[] {
  if (baseline.length !== candidate.length) throw new Error('paired runs differ in length')
  return baseline.map((hand, index) => {
    const other = candidate[index]
    if (
      other === undefined ||
      other.commit !== hand.commit ||
      other.position !== hand.position ||
      other.depth !== hand.depth ||
      other.handClass !== hand.handClass
    ) {
      throw new Error('paired sessions dealt different hands')
    }
    return {
      ...hand,
      baselineChips: hand.focalChips,
      candidateChips: other.focalChips,
      deltaChips: other.focalChips - hand.focalChips,
    }
  })
}

export interface ClusteredEstimate {
  readonly hands: number
  readonly sessions: number
  readonly bigBlindsPer100: number
  readonly interval95: readonly [number, number]
}

export type SliceDimension = 'position' | 'depth' | 'handClass'

export interface SliceSummary {
  readonly dimension: SliceDimension
  readonly value: string
  readonly delta: ClusteredEstimate
  readonly baseline: ClusteredEstimate
}

export interface PairedSessionSummary {
  readonly delta: ClusteredEstimate
  readonly baseline: ClusteredEstimate
  readonly candidate: ClusteredEstimate
  readonly changedHands: number
  readonly slices: readonly SliceSummary[]
}

export function summarisePairs(
  result: PairedSessionResult,
  bigBlind: number = DEFAULT_STAKE.bigBlind,
): PairedSessionSummary {
  const { pairs, sessions } = result
  const estimate = (rows: readonly SessionPair[], value: (pair: SessionPair) => number) =>
    clusteredEstimate(
      rows.map((pair) => ({ session: pair.session, value: value(pair) })),
      sessions,
      bigBlind,
    )
  const slices: SliceSummary[] = []
  for (const dimension of ['position', 'depth', 'handClass'] as const) {
    const values = [...new Set(pairs.map((pair) => pair[dimension]))].sort()
    for (const value of values) {
      const rows = pairs.filter((pair) => pair[dimension] === value)
      slices.push({
        dimension,
        value,
        delta: estimate(rows, (pair) => pair.deltaChips),
        baseline: estimate(rows, (pair) => pair.baselineChips),
      })
    }
  }
  return {
    delta: estimate(pairs, (pair) => pair.deltaChips),
    baseline: estimate(pairs, (pair) => pair.baselineChips),
    candidate: estimate(pairs, (pair) => pair.candidateChips),
    changedHands: pairs.filter((pair) => pair.deltaChips !== 0).length,
    slices,
  }
}

export interface RunSliceSummary {
  readonly dimension: SliceDimension
  readonly value: string
  readonly estimate: ClusteredEstimate
}

export interface RunSummary {
  readonly overall: ClusteredEstimate
  readonly slices: readonly RunSliceSummary[]
}

export function summariseRun(
  hands: readonly SessionHandResult[],
  sessions: number,
  bigBlind: number = DEFAULT_STAKE.bigBlind,
): RunSummary {
  const estimate = (rows: readonly SessionHandResult[]) =>
    clusteredEstimate(
      rows.map((hand) => ({ session: hand.session, value: hand.focalChips })),
      sessions,
      bigBlind,
    )
  const slices: RunSliceSummary[] = []
  for (const dimension of ['position', 'depth', 'handClass'] as const) {
    for (const value of [...new Set(hands.map((hand) => hand[dimension]))].sort()) {
      slices.push({
        dimension,
        value,
        estimate: estimate(hands.filter((hand) => hand[dimension] === value)),
      })
    }
  }
  return { overall: estimate(hands), slices }
}

/**
 * Mean chips per hand, as big blinds per 100 hands, with a session-clustered
 * 95% interval.
 *
 * A slice is a ratio of two per-session totals, so its variance uses the
 * linearised cluster-robust form: every session counts, including one with no
 * hand in the slice, and the spread comes from how far each session's total
 * sits from the pooled mean times that session's hand count.
 */
export function clusteredEstimate(
  rows: readonly { readonly session: number; readonly value: number }[],
  sessions: number,
  bigBlind: number = DEFAULT_STAKE.bigBlind,
): ClusteredEstimate {
  if (!Number.isSafeInteger(sessions) || sessions < 2) {
    throw new Error('a clustered estimate needs at least two sessions')
  }
  const sums = new Array<number>(sessions).fill(0)
  const counts = new Array<number>(sessions).fill(0)
  for (const row of rows) {
    if (row.session < 0 || row.session >= sessions) throw new Error('row outside the sessions')
    sums[row.session] = (sums[row.session] ?? 0) + row.value
    counts[row.session] = (counts[row.session] ?? 0) + 1
  }
  const hands = rows.length
  const scale = 100 / bigBlind
  if (hands === 0) {
    return { hands, sessions: 0, bigBlindsPer100: 0, interval95: [0, 0] }
  }
  const total = sums.reduce((sum, value) => sum + value, 0)
  const mean = total / hands
  let residual = 0
  for (let session = 0; session < sessions; session += 1) {
    residual += ((sums[session] ?? 0) - mean * (counts[session] ?? 0)) ** 2
  }
  const standardError = Math.sqrt((sessions / (sessions - 1)) * residual) / hands
  const radius = studentT975(sessions - 1) * standardError
  return {
    hands,
    sessions: counts.filter((count) => count > 0).length,
    bigBlindsPer100: mean * scale,
    interval95: [(mean - radius) * scale, (mean + radius) * scale],
  }
}

// Two-sided 95% Student t quantiles for 1-30 degrees of freedom, from standard tables.
const T975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
] as const

export function studentT975(degreesOfFreedom: number): number {
  if (!Number.isSafeInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
    throw new Error('degrees of freedom must be a positive integer')
  }
  const tabled = T975[degreesOfFreedom - 1]
  if (tabled !== undefined) return tabled
  const z = 1.959964
  const v = degreesOfFreedom
  return (
    z +
    (z ** 3 + z) / (4 * v) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * v ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * v ** 3)
  )
}

export interface EvidenceYieldSummary {
  readonly opponentSessions: number
  readonly perOpponentSession: Readonly<
    Record<
      | 'hands'
      | 'preflopFacedRaise'
      | 'postflopFacedBet'
      | 'postflopCheckedTo'
      | 'riverFacedBet'
      | 'riverCheckedTo'
      | 'showed'
      | 'shownRiverAggression',
      { readonly mean: number; readonly minimum: number; readonly maximum: number }
    >
  >
}

export function summariseEvidenceYield(
  evidence: readonly OpponentEvidenceYield[],
): EvidenceYieldSummary {
  const measures = {
    hands: (row: OpponentEvidenceYield) => row.hands,
    preflopFacedRaise: (row: OpponentEvidenceYield) => row.preflopFacedRaise,
    postflopFacedBet: (row: OpponentEvidenceYield) =>
      POSTFLOP_STREETS.reduce((sum, street) => sum + row.facedBet[street], 0),
    postflopCheckedTo: (row: OpponentEvidenceYield) =>
      POSTFLOP_STREETS.reduce((sum, street) => sum + row.checkedTo[street], 0),
    riverFacedBet: (row: OpponentEvidenceYield) => row.facedBet.river,
    riverCheckedTo: (row: OpponentEvidenceYield) => row.checkedTo.river,
    showed: (row: OpponentEvidenceYield) => row.showed,
    shownRiverAggression: (row: OpponentEvidenceYield) => row.shownRiverAggression,
  }
  const perOpponentSession = Object.fromEntries(
    Object.entries(measures).map(([name, measure]) => {
      const values = evidence.map(measure)
      return [
        name,
        {
          mean: values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length,
          minimum: values.length === 0 ? 0 : Math.min(...values),
          maximum: values.length === 0 ? 0 : Math.max(...values),
        },
      ]
    }),
  ) as EvidenceYieldSummary['perOpponentSession']
  return { opponentSessions: evidence.length, perOpponentSession }
}
