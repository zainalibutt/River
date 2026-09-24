import { type BotPolicy, parseCard, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import {
  depthClass,
  handClassOf,
  positionClass,
  runSessions,
  type SessionTableSpec,
  type SettledSessionHand,
} from './bot-session-benchmark.js'
import {
  clusteredEstimate,
  runPairedSessions,
  studentT975,
  summariseEvidenceYield,
  summarisePairs,
} from './bot-session-evaluation.js'
import { heldOutStylePolicy } from './bot-style-opponents.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}

const headsUp: SessionTableSpec = {
  name: 'heads-up-overbluff',
  style: 'overbluff',
  entrants: [
    { personality: person(4) },
    { personality: person(0), policy: heldOutStylePolicy('overbluff') },
  ],
}

const nine: SessionTableSpec = {
  name: 'nine-balanced',
  style: 'balanced',
  entrants: [
    { personality: person(10) },
    ...[0, 2, 3, 7].map((index) => ({
      personality: person(index),
      policy: heldOutStylePolicy('balanced'),
    })),
    ...[1, 5, 6, 8].map((index) => ({ personality: person(index) })),
  ],
}

function renamed(policy: BotPolicy, id: string): BotPolicy {
  return {
    id,
    version: 1,
    decide(context) {
      return { ...policy.decide(context), policyId: id, policyVersion: 1 }
    },
  }
}

const foldPremium: BotPolicy = {
  id: 'planted-premium-fold',
  version: 1,
  decide(context) {
    const envelope = pokerGuardPolicy.decide(context)
    const { observation } = context
    const decision =
      observation.street === 'preflop' &&
      handClassOf(observation.actor.hole) === 'premium' &&
      observation.legal.fold &&
      observation.amountToCall > 0
        ? { kind: 'fold' as const }
        : envelope.decision
    return { ...envelope, policyId: this.id, policyVersion: this.version, decision }
  },
}

describe('session benchmark', () => {
  it('classifies position, depth and starting hand the way the report names them', () => {
    expect([0, 1].map((offset) => positionClass(offset, 2))).toEqual(['button', 'big-blind'])
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((offset) => positionClass(offset, 9))).toEqual([
      'late',
      'blinds',
      'blinds',
      'early',
      'early',
      'early',
      'middle',
      'middle',
      'late',
    ])
    expect([40, 100, 200, 400].map(depthClass)).toEqual(['short', 'standard', 'deep', 'deep'])
    const hand = (text: string) => handClassOf(text.split(' ').map(parseCard))
    expect(
      ['As Ah', 'Ks Ad', 'Qh Qd', 'Jc Jd', 'As Qd', 'Kh Qh', '9s 9d', 'Ah 5h', '8c 7c'].map(hand),
    ).toEqual([
      'premium',
      'premium',
      'premium',
      'strong',
      'strong',
      'strong',
      'pair',
      'suited-playable',
      'suited-playable',
    ])
    expect(['Kd Js', '9h 4c', 'Qc 8d'].map(hand)).toEqual(['offsuit-broadway', 'weak', 'weak'])
  })

  it('replays a campaign exactly from its seed', () => {
    const options = {
      seed: 'session-replay',
      sessions: 2,
      handsPerSession: 6,
      table: nine,
      focalPolicy: pokerGuardPolicy,
    }
    expect(runSessions(options)).toEqual(runSessions(options))
  })

  it('pairs a policy with a renamed copy of itself to exactly zero on every hand', () => {
    const result = runPairedSessions({
      seed: 'session-a-a',
      sessions: 3,
      handsPerSession: 12,
      table: nine,
      baseline: pokerGuardPolicy,
      candidate: renamed(pokerGuardPolicy, 'poker-guard-copy'),
    })
    expect(result.pairs).toHaveLength(36)
    expect(result.pairs.every((pair) => pair.deltaChips === 0)).toBe(true)
    const summary = summarisePairs(result)
    expect(summary.changedHands).toBe(0)
    expect(summary.delta.interval95).toEqual([0, 0])
  })

  it('confines a planted premium-hand leak to the premium slice when the focal ignores memory', () => {
    const table: SessionTableSpec = {
      ...headsUp,
      entrants: [{ personality: person(5) }, ...headsUp.entrants.slice(1)],
    }
    const result = runPairedSessions({
      seed: 'session-planted',
      sessions: 4,
      handsPerSession: 40,
      table,
      baseline: pokerGuardPolicy,
      candidate: foldPremium,
    })
    const outside = result.pairs.filter((pair) => pair.handClass !== 'premium')
    const inside = result.pairs.filter((pair) => pair.handClass === 'premium')
    expect(outside.every((pair) => pair.deltaChips === 0)).toBe(true)
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.some((pair) => pair.deltaChips !== 0)).toBe(true)
  })

  it('gives a memory plugin only settled records and publicly shown cards', () => {
    const seen: SettledSessionHand[] = []
    runSessions({
      seed: 'session-plugin',
      sessions: 2,
      handsPerSession: 10,
      table: headsUp,
      focalPolicy: pokerGuardPolicy,
      plugin: () => ({
        observe(hand) {
          seen.push(hand)
        },
        actionOptions: () => ({}),
      }),
    })
    expect(seen).toHaveLength(20)
    for (const hand of seen) {
      for (const [playerId] of hand.shown) {
        const seat = hand.record.seats.find((entry) => entry.playerId === playerId)?.seat
        expect(hand.record.results.find((entry) => entry.seat === seat)?.showed).toBe(true)
      }
    }
  })

  it('keeps one focal memory through a chain of sessions and starts afresh at the next chain', () => {
    const plugins: number[] = []
    const focalIds: string[] = []
    const result = runSessions({
      seed: 'session-chain',
      sessions: 4,
      handsPerSession: 5,
      chainLength: 2,
      table: headsUp,
      focalPolicy: pokerGuardPolicy,
      focalPersonalities: [person(9), person(10)],
      plugin: () => {
        const seen = { hands: 0 }
        plugins.push(0)
        return {
          observe(hand) {
            seen.hands += 1
            plugins[plugins.length - 1] = seen.hands
            focalIds.push(
              hand.record.seats
                .map((seat) => seat.playerId)
                .sort()
                .join(','),
            )
          },
          actionOptions: () => ({}),
        }
      },
    })
    expect(plugins).toEqual([10, 10])
    expect(result.hands.map((hand) => hand.encounter)).toEqual([
      ...Array(5).fill(0),
      ...Array(5).fill(1),
      ...Array(5).fill(0),
      ...Array(5).fill(1),
    ])
    expect(new Set(focalIds.slice(0, 10)).size).toBe(1)
    expect(focalIds[0]).not.toBe(focalIds[10])
    expect(() =>
      runSessions({
        seed: 'x',
        sessions: 3,
        handsPerSession: 1,
        chainLength: 2,
        table: headsUp,
        focalPolicy: pokerGuardPolicy,
      }),
    ).toThrow('whole chains')
  })

  it('counts each opponent’s public opportunities per session', () => {
    const result = runSessions({
      seed: 'session-yield',
      sessions: 2,
      handsPerSession: 15,
      table: nine,
      focalPolicy: pokerGuardPolicy,
    })
    expect(result.evidence).toHaveLength(16)
    expect(result.evidence.every((row) => row.hands === 15)).toBe(true)
    const summary = summariseEvidenceYield(result.evidence)
    expect(summary.opponentSessions).toBe(16)
    expect(summary.perOpponentSession.hands.mean).toBe(15)
    expect(summary.perOpponentSession.postflopFacedBet.mean).toBeGreaterThan(0)
  })
})

describe('clustered estimate', () => {
  it('matches a hand calculation of the session-clustered ratio interval', () => {
    const rows = [
      { session: 0, value: 500 },
      { session: 0, value: -500 },
      { session: 1, value: 1_000 },
      { session: 2, value: 0 },
      { session: 2, value: 1_500 },
    ]
    const estimate = clusteredEstimate(rows, 3, 500)
    const mean = 2_500 / 5
    const residual = (0 - mean * 2) ** 2 + (1_000 - mean) ** 2 + (1_500 - mean * 2) ** 2
    const radius = studentT975(2) * (Math.sqrt(1.5 * residual) / 5)
    expect(estimate.bigBlindsPer100).toBeCloseTo((mean / 500) * 100, 10)
    expect(estimate.interval95[0]).toBeCloseTo(((mean - radius) / 500) * 100, 10)
    expect(estimate.interval95[1]).toBeCloseTo(((mean + radius) / 500) * 100, 10)
  })

  it('uses tabled t quantiles and a converging expansion beyond them', () => {
    expect(studentT975(1)).toBe(12.706)
    expect(studentT975(30)).toBe(2.042)
    expect(studentT975(31)).toBeCloseTo(2.0395, 3)
    expect(studentT975(120)).toBeCloseTo(1.9799, 3)
  })
})
