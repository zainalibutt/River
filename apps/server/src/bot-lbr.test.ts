import {
  type BotObservationV1,
  type BotPolicy,
  DEFAULT_STAKE,
  makeDeck,
  personalityPool,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { alwaysCallPolicy, alwaysFoldPolicy, localBestResponse } from './bot-lbr.js'
import {
  candidateHoldings,
  decisionClass,
  LBR_RANGE_TUNING,
  recordedClass,
  updateRange,
} from './bot-lbr-range.js'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { type FocalDecisionPoint, runSessions } from './bot-session-benchmark.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}

function probeRun(
  focal: BotPolicy,
  hands: number,
  watch?: (point: FocalDecisionPoint, probeWatch: (point: FocalDecisionPoint) => void) => void,
) {
  const probe = localBestResponse(focal)
  return runSessions({
    seed: 'lbr-test',
    sessions: 2,
    handsPerSession: hands / 2,
    table: {
      name: 'heads-up-best-response',
      style: 'best-response',
      entrants: [{ personality: person(10) }, { personality: person(0), policy: probe.policy }],
    },
    focalPolicy: focal,
    onFocalDecision: (point) =>
      watch === undefined ? probe.watch(point) : watch(point, probe.watch),
  }).hands
}

function firstPreflopPoint(): FocalDecisionPoint {
  let found: FocalDecisionPoint | undefined
  runSessions({
    seed: 'lbr-range-test',
    sessions: 2,
    handsPerSession: 1,
    table: {
      name: 'heads-up',
      style: 'plain',
      entrants: [{ personality: person(10) }, { personality: person(0) }],
    },
    focalPolicy: legacyGuardPolicy,
    onFocalDecision: (point) => {
      found ??= point
    },
  })
  if (found === undefined) throw new Error('no focal decision captured')
  return found
}

/** Raises with any pair and checks or calls with everything else. */
const pairRaiser: BotPolicy = {
  id: 'pair-raiser',
  version: 1,
  decide(context) {
    const { observation } = context
    const [first, second] = observation.actor.hole
    const pair = first !== undefined && first.rank === second?.rank
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: observation.version,
      decision: pair
        ? { kind: 'raiseTo', to: observation.legal.raiseTo.min }
        : observation.legal.check
          ? { kind: 'check' }
          : { kind: 'call' },
      fallbackReason: null,
    }
  },
}

describe('local best response', () => {
  it('wins exactly the blinds from a seat that never puts a chip in', () => {
    const hands = probeRun(alwaysFoldPolicy, 20)
    const lost = hands.reduce((sum, hand) => sum - hand.focalChips, 0)
    expect(lost).toBe(0.75 * DEFAULT_STAKE.bigBlind * hands.length)
  })

  it('beats a seat that never folds', () => {
    const hands = probeRun(alwaysCallPolicy, 100)
    expect(hands.reduce((sum, hand) => sum - hand.focalChips, 0)).toBeGreaterThan(0)
  })

  it('plays the same whatever the focal seat actually holds', () => {
    const plain = probeRun(legacyGuardPolicy, 12).map((hand) => hand.focalChips)
    const [first, second] = makeDeck()
    if (first === undefined || second === undefined) throw new Error('deck missing')
    const blinded = probeRun(legacyGuardPolicy, 12, (point, watch) =>
      watch({
        ...point,
        observation: {
          ...point.observation,
          actor: { ...point.observation.actor, hole: [first, second] },
        },
      }),
    ).map((hand) => hand.focalChips)
    expect(blinded).toEqual(plain)
  })
})

describe('range tracking', () => {
  it('keeps the holdings that make the move and all but drops the rest', () => {
    const point = firstPreflopPoint()
    const range = candidateHoldings(point.observation.board, 'range')
    expect(range).toHaveLength(LBR_RANGE_TUNING.maximumHoldings)
    updateRange(
      range,
      pairRaiser,
      point.entrants[0]?.personality ?? person(10),
      point.observation,
      'aggressive',
      'move',
    )
    const { samplesPerHolding, smoothing } = LBR_RANGE_TUNING
    const kept = (samplesPerHolding + smoothing) / (samplesPerHolding + 2 * smoothing)
    const dropped = smoothing / (samplesPerHolding + 2 * smoothing)
    for (const holding of range) {
      const pair = holding.hole[0].rank === holding.hole[1].rank
      expect(holding.weight).toBeCloseTo(pair ? kept : dropped, 10)
    }
  })

  it('classes decisions and recorded moves as the table treats them', () => {
    const { observation } = firstPreflopPoint()
    const facing: BotObservationV1 = { ...observation, amountToCall: 50, currentBet: 100 }
    expect(decisionClass({ kind: 'fold' }, facing)).toBe('fold')
    expect(decisionClass({ kind: 'call' }, facing)).toBe('passive')
    expect(decisionClass({ kind: 'raiseTo', to: 300 }, facing)).toBe('aggressive')
    expect(decisionClass({ kind: 'raiseTo', to: 100 }, facing)).toBe('passive')
    expect(decisionClass({ kind: 'allIn' }, facing)).toBe('aggressive')
    const entry = { seat: 0, street: 'preflop' as const, streetBetAfter: 100 }
    expect(recordedClass({ ...entry, action: { kind: 'allIn' } }, facing)).toBe('passive')
    expect(recordedClass({ ...entry, action: { kind: 'call' } }, facing)).toBe('passive')
    expect(recordedClass({ ...entry, action: { kind: 'fold' } }, facing)).toBe('fold')
    expect(
      recordedClass(
        { ...entry, action: { kind: 'raiseTo', to: 300 }, streetBetAfter: 300 },
        facing,
      ),
    ).toBe('aggressive')
  })
})
