import { readFileSync } from 'node:fs'
import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  mulberry32,
  parseCard,
  personalityPool,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { riverSolverPolicy } from './bot-river-policy.js'
import { profileFor } from './bot-service.js'
import { runSessions } from './bot-session-benchmark.js'
import { turnSolverPolicy } from './bot-turn-policy.js'
import { type ValueNetworkDescription, valueNetworkFrom } from './bot-value-network.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}
// A small network with random weights stands in for the turn-end network:
// these tests check the wiring, not how well the network values a turn.
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))

describe('the turn-solving OG', () => {
  it('plays exactly the base policy away from the turn', () => {
    const base = riverSolverPolicy(legacyGuardPolicy, 'river-solver-test', 1, { iterations: 10 })
    const { policy } = turnSolverPolicy(base.policy, network, 'turn-solver-test', 1)
    const board = ['Qs', '9h', '6d'].map(parseCard)
    const observation = {
      version: 1,
      roomId: 'turn-policy-test',
      handNumber: 1,
      actor: {
        playerId: 'a',
        seat: 0,
        hole: ['Ah', 'Kh'].map(parseCard),
        stack: 9800,
        betHand: 100,
        betStreet: 0,
      },
      street: 'flop',
      board,
      dealerSeat: 1,
      pot: 400,
      currentBet: 0,
      amountToCall: 0,
      legal: {
        fold: true,
        check: true,
        call: { enabled: false, amount: 0 },
        raiseTo: { enabled: true, min: 100, max: 9800 },
        allIn: { enabled: true, amount: 9800 },
      },
      seats: [
        {
          seat: 0,
          playerId: 'a',
          stack: 9800,
          betHand: 100,
          betStreet: 0,
          folded: false,
          allIn: false,
          away: false,
        },
        {
          seat: 1,
          playerId: 'b',
          stack: 9800,
          betHand: 100,
          betStreet: 0,
          folded: false,
          allIn: false,
          away: false,
        },
      ],
      opponents: [],
      actions: [],
      tilt: { factor: 0 },
    } as BotObservationV1
    for (let seed = 0; seed < 20; seed += 1) {
      const context = {
        observation,
        profile: profileFor(person(10)),
        personality: person(10),
        tilt: observation.tilt,
        rng: mulberry32(seed),
      }
      const replay = { ...context, rng: mulberry32(seed) }
      expect(policy.decide(context).decision).toEqual(base.policy.decide(replay).decision)
    }
  })

  it('answers two-player turns from the solve with legal moves', () => {
    const base = riverSolverPolicy(legacyGuardPolicy, 'river-solver-test', 1, { iterations: 10 })
    const solver = turnSolverPolicy(base.policy, network, 'turn-solver-test', 1, { iterations: 10 })
    const turn: { observation: BotObservationV1; decision: BotDecision }[] = []
    const focal: BotPolicy = {
      id: solver.policy.id,
      version: solver.policy.version,
      decide(context) {
        const envelope = solver.policy.decide(context)
        if (context.observation.street === 'turn') {
          turn.push({ observation: context.observation, decision: envelope.decision })
        }
        return envelope
      },
    }
    runSessions({
      seed: 'turn-policy-test',
      sessions: 2,
      handsPerSession: 6,
      table: {
        name: 'heads-up',
        style: 'plain',
        entrants: [{ personality: person(10) }, { personality: person(0) }],
      },
      focalPolicy: focal,
    })
    expect(turn.length).toBeGreaterThan(0)
    expect(solver.stats.solved).toBeGreaterThan(0)
    expect(
      solver.stats.solved + Object.values(solver.stats.fallbacks).reduce((a, b) => a + b, 0),
    ).toBe(turn.length)
    for (const { observation, decision } of turn) {
      const { legal } = observation
      if (decision.kind === 'check') expect(legal.check).toBe(true)
      if (decision.kind === 'fold') expect(legal.check).toBe(false)
      if (decision.kind === 'call') expect(legal.call.enabled).toBe(true)
      if (decision.kind === 'allIn') expect(legal.allIn.enabled).toBe(true)
      if (decision.kind === 'raiseTo') {
        expect(legal.raiseTo.enabled).toBe(true)
        expect(decision.to).toBeGreaterThanOrEqual(legal.raiseTo.min)
        expect(decision.to).toBeLessThan(legal.raiseTo.max)
      }
    }
  }, 300_000)
})
