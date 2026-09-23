import {
  type BotPolicy,
  deterministicRulePolicy,
  personalityPool,
  SEATS_PER_SHAPE,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { runBotBenchmark, runPairedBotBenchmark } from './bot-benchmark.js'

const cast = personalityPool()

describe('headless bot benchmark', () => {
  it.each([2, 3, 6, 8, 9])('finishes seeded %i-seat hands without losing chips', (count) => {
    const seats = cast.slice(0, count).map((personality) => ({ personality }))
    const result = runBotBenchmark({ seed: 'benchmark-one', hands: 3, seats })
    expect(result.results).toHaveLength(3)
    expect(
      result.results.every((hand) => hand.actions.reduce((sum, value) => sum + value, 0) > 0),
    ).toBe(true)
    expect(
      result.results.every((hand) => hand.netChips.reduce((sum, value) => sum + value, 0) === 0),
    ).toBe(true)
    expect(result.seats.reduce((sum, seat) => sum + seat.netChips, 0)).toBe(0)
  })

  it('rejects a cast larger than the configured full table', () => {
    const seats = cast.slice(0, SEATS_PER_SHAPE.full + 1).map((personality) => ({ personality }))
    expect(() => runBotBenchmark({ seed: 'too-many', hands: 1, seats })).toThrow(
      `benchmark needs two to ${SEATS_PER_SHAPE.full} seats`,
    )
  })

  it('replays the same seed exactly and changes the deck commitment with a new seed', () => {
    const seats = cast.slice(0, 3).map((personality) => ({ personality }))
    const input = { seed: 'replay-one', hands: 4, seats }
    const first = runBotBenchmark(input)
    expect(runBotBenchmark(input)).toEqual(first)
    expect(runBotBenchmark({ ...input, seed: 'replay-two' }).results[0]?.commit).not.toBe(
      first.results[0]?.commit,
    )
  })

  it('rotates entrants through every chair without changing result attribution', () => {
    const seats = cast.slice(0, 3).map((personality) => ({ personality }))
    const result = runBotBenchmark({ seed: 'rotate', hands: 3, seats })
    expect(result.results.map((hand) => hand.chairByEntrant)).toEqual([
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ])
    for (let entrant = 0; entrant < 3; entrant += 1) {
      expect(result.seats[entrant]?.netChips).toBe(
        result.results.reduce((sum, hand) => sum + (hand.netChips[entrant] ?? 0), 0),
      )
    }
  })

  it('compares a focal policy against a matched baseline with a reproducible confidence interval', () => {
    const seats = cast.slice(0, 3).map((personality) => ({ personality }))
    const result = runPairedBotBenchmark({
      seed: 'paired',
      hands: 12,
      seats,
      baseline: deterministicRulePolicy,
      candidate: passivePolicy,
      focalEntrant: 1,
    })
    expect(result.pairs).toHaveLength(12)
    expect(result.pairs.every((pair) => pair.commit.length > 0)).toBe(true)
    expect(result.delta.wins + result.delta.losses + result.delta.ties).toBe(12)
    expect(result.delta.confidence95Chips[0]).toBeLessThanOrEqual(result.delta.meanChips)
    expect(result.delta.confidence95Chips[1]).toBeGreaterThanOrEqual(result.delta.meanChips)
    expect(
      result.pairs.map((pair) => pair.deltaChips).reduce((sum, delta) => sum + delta, 0) /
        result.hands,
    ).toBe(result.delta.meanChips)
    expect(
      runPairedBotBenchmark({
        seed: 'paired',
        hands: 12,
        seats,
        baseline: deterministicRulePolicy,
        candidate: passivePolicy,
        focalEntrant: 1,
      }),
    ).toEqual(result)
  })

  it('reports zero paired difference when candidate and baseline are the same policy', () => {
    const seats = cast.slice(0, 2).map((personality) => ({ personality }))
    const result = runPairedBotBenchmark({
      seed: 'same-policy',
      hands: 6,
      seats,
      baseline: deterministicRulePolicy,
      candidate: deterministicRulePolicy,
      focalEntrant: 0,
    })
    expect(result.pairs.every((pair) => pair.deltaChips === 0)).toBe(true)
    expect(result.delta).toMatchObject({
      meanChips: 0,
      standardErrorChips: 0,
      confidence95Chips: [0, 0],
      wins: 0,
      losses: 0,
      ties: 6,
    })
  })

  it('keeps paired hands identical through a single-decision audit wrapper', () => {
    const seats = cast.slice(0, 3).map((personality) => ({ personality }))
    const wrapped: BotPolicy = {
      id: 'single-decision-audit',
      version: 1,
      decide(context) {
        const baseline = deterministicRulePolicy.decide(context)
        return { ...baseline, policyId: this.id, policyVersion: this.version }
      },
    }
    const result = runPairedBotBenchmark({
      seed: 'audit-rng-integrity',
      hands: 48,
      seats,
      baseline: deterministicRulePolicy,
      candidate: wrapped,
      focalEntrant: 0,
    })
    expect(result.pairs.every((pair) => pair.deltaChips === 0)).toBe(true)
    expect(result.delta.confidence95Chips).toEqual([0, 0])
  })

  it('passes the current hand action sequence to policies during replay', () => {
    const actionCounts: number[] = []
    const observer: BotPolicy = {
      id: 'history-observer',
      version: 1,
      decide(context) {
        actionCounts.push(context.observation.actions?.length ?? -1)
        return { ...deterministicRulePolicy.decide(context), policyId: this.id }
      },
    }
    const seats = cast.slice(0, 2).map((personality) => ({ personality, policy: observer }))
    runBotBenchmark({ seed: 'history-replay', hands: 3, seats })
    expect(actionCounts[0]).toBe(0)
    expect(actionCounts.some((count) => count > 0)).toBe(true)
    expect(actionCounts.filter((count) => count === 0).length).toBeGreaterThanOrEqual(3)
  })

  it('reports the accepted action with its pre-action observation', () => {
    const seats = cast.slice(0, 2).map((personality) => ({ personality }))
    const decisions: { prior: number; action: string; actor: string }[] = []
    const result = runBotBenchmark({
      seed: 'decision-hook',
      hands: 1,
      seats,
      onDecision({ observation, action, actorId }) {
        decisions.push({
          prior: observation.actions?.length ?? -1,
          action: action.kind,
          actor: actorId,
        })
        expect(observation.actor.playerId).toBe(actorId)
        expect(observation.legal).toBeDefined()
      },
    })
    expect(decisions).toHaveLength(result.results[0]?.actions.reduce((sum, n) => sum + n, 0) ?? 0)
    expect(decisions[0]?.prior).toBe(0)
    expect(decisions.map((decision) => decision.prior)).toEqual(decisions.map((_, index) => index))
  })

  it('reports only public terminal cards after the decision hook has run', () => {
    const seats = cast.slice(0, 2).map((personality) => ({ personality }))
    const completed: { index: number; revealed: boolean; visibleHoles: number }[] = []
    runBotBenchmark({
      seed: 'terminal-public-view',
      hands: 20,
      seats,
      onDecision({ observation }) {
        expect(observation.actor.hole).toHaveLength(2)
        expect(observation).not.toHaveProperty('opponentHole')
      },
      onHandComplete({ handIndex, view }) {
        expect(view.phase).toBe('between')
        const visibleHoles = view.seats.filter((seat) => seat.hole !== null).length
        if (!view.revealed) expect(visibleHoles).toBe(0)
        completed.push({ index: handIndex, revealed: view.revealed, visibleHoles })
      },
    })
    expect(completed.map((hand) => hand.index)).toEqual(Array.from({ length: 20 }, (_, i) => i))
    expect(completed.some((hand) => hand.revealed && hand.visibleHoles === 2)).toBe(true)
  })

  it('does not let terminal observers alter recorded chip outcomes', () => {
    const seats = cast.slice(0, 2).map((personality) => ({ personality }))
    const options = { seed: 'terminal-observer-isolation', hands: 4, seats }
    const baseline = runBotBenchmark(options)
    const observed = runBotBenchmark({
      ...options,
      onHandComplete({ view }) {
        const seat = view.seats[0]
        if (seat !== undefined) seat.stack = 1
      },
    })
    expect(observed).toEqual(baseline)
  })

  it('rejects invalid table and sample definitions', () => {
    const seats = cast.slice(0, 2).map((personality) => ({ personality }))
    const firstSeat = seats[0]
    if (firstSeat === undefined) throw new Error('test cast missing')
    expect(() => runBotBenchmark({ seed: 'x', hands: 0, seats })).toThrow('positive safe integer')
    expect(() => runBotBenchmark({ seed: 'x', hands: 1, seats: seats.slice(0, 1) })).toThrow(
      `two to ${SEATS_PER_SHAPE.full}`,
    )
    expect(() => runBotBenchmark({ seed: 'x', hands: 1, seats: [firstSeat, firstSeat] })).toThrow(
      'unique',
    )
    expect(() =>
      runPairedBotBenchmark({
        seed: 'x',
        hands: 1,
        seats,
        baseline: deterministicRulePolicy,
        candidate: deterministicRulePolicy,
        focalEntrant: 0,
      }),
    ).toThrow('at least two hands')
    expect(() =>
      runPairedBotBenchmark({
        seed: 'x',
        hands: 2,
        seats,
        baseline: deterministicRulePolicy,
        candidate: deterministicRulePolicy,
        focalEntrant: 2,
      }),
    ).toThrow('must be seated')
  })
})

const passivePolicy: BotPolicy = {
  id: 'passive-benchmark',
  version: 1,
  decide(context) {
    const legal = context.observation.legal
    const decision = legal.check ? { kind: 'check' as const } : { kind: 'fold' as const }
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: context.observation.version,
      decision,
      fallbackReason: null,
    }
  },
}
