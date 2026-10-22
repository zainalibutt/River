import {
  type BotObservationV1,
  type BotOpponentStatsV2,
  type BotPolicyContextV1,
  type Card,
  mulberry32,
  parseCard,
  personalityPool,
  rateEstimate,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { alwaysCallPolicy } from './bot-lbr.js'
import { publicDecisions } from './bot-public-replay.js'
import type { RiverCarrySource } from './bot-river-carry.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import * as solver from './bot-river-solver.js'
import { profileFor } from './bot-service.js'

vi.mock('./bot-public-replay.js', () => ({ publicDecisions: vi.fn() }))
const cards = (s: string) => s.split(' ').map(parseCard)
const person = personalityPool()[10]
if (!person) throw new Error('missing personality')
function reads(fold: number): BotOpponentStatsV2 {
  const rate = (p: number) =>
    rateEstimate(100 * p, 100, 0.4, { priorStrength: 3, intervalZ: 1.645 })
  return {
    playerId: 'b',
    version: 2,
    hands: 100,
    vpip: rate(0.5),
    pfr: rate(0.2),
    foldToPreflopRaise: rate(0.4),
    foldToBet: rate(fold),
    foldToBetBySize: { small: rate(fold), medium: rate(fold), large: rate(fold) },
    raiseVsBet: rate(0),
    betWhenCheckedTo: rate(0.4),
    riverBetWhenCheckedTo: rate(0.4),
    betSizes: { small: 100, medium: 0, large: 0 },
    shownRiverAggression: { air: 30, pair: 20, made: 50 },
  }
}
function view(): BotObservationV1 {
  return {
    version: 1,
    roomId: 'bounded',
    handNumber: 1,
    street: 'river',
    board: cards('Ah Kd 7s 4c 2h'),
    dealerSeat: 1,
    actor: { playerId: 'a', seat: 0, hole: cards('5c 6d'), stack: 200, betHand: 0, betStreet: 0 },
    pot: 100,
    currentBet: 0,
    amountToCall: 0,
    legal: {
      fold: false,
      check: true,
      call: { enabled: false, amount: 0 },
      raiseTo: { enabled: true, min: 1, max: 200 },
      allIn: { enabled: true, amount: 200 },
    },
    seats: ['a', 'b'].map((playerId, seat) => ({
      playerId,
      seat,
      stack: 200,
      betHand: 0,
      betStreet: 0,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    opponentStats: [reads(0.99)],
    actions: [],
    tilt: { factor: 0 },
  }
}
const context = (observation: BotObservationV1, seed = 1): BotPolicyContextV1 => ({
  observation,
  profile: profileFor(person),
  personality: person,
  tilt: observation.tilt,
  rng: mulberry32(seed),
})
const carry: RiverCarrySource = () => ({
  ranges: [
    [{ hole: cards('5c 6d') as [Card, Card], weight: 0.3 }],
    [{ hole: cards('7c 7d') as [Card, Card], weight: 1 }],
  ],
  gadget: { player: 1, promises: Float64Array.of(1000) },
})
const tuning = {
  ...RIVER_CANDIDATE_TUNING,
  safe: true,
  carry: 'per-river' as const,
  iterations: 12,
  betSizes: [0.5],
  maxRaises: 0,
  cacheSize: 1,
}
afterEach(() => vi.restoreAllMocks())

describe('bounded river policy opt-in and freeze', () => {
  it('freezes across adversarial read/tilt changes, later actions and cache pressure until settlement', () => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const count = vi.spyOn(solver, 'solveRiver')
    const bot = riverSolverPolicy(
      alwaysCallPolicy,
      'test',
      1,
      { ...tuning, boundedReads: true },
      undefined,
      undefined,
      carry,
    )
    const observation = view()
    const first = bot.policy.decide(context(observation))
    expect(bot.stats.adaptationChecks).toBe(1)
    expect(bot.stats.adaptationProposals).toBe(1)
    const solves = count.mock.calls.length
    for (const fold of [0, 1, 0.2, 0.99]) {
      expect(
        bot.policy.decide(
          context({ ...observation, opponentStats: [reads(fold)], tilt: { factor: fold } }),
        ).decision,
      ).toEqual(first.decision)
    }
    expect(count.mock.calls.length).toBe(solves)
    // A different room cannot evict an active river, even with cacheSize=1.
    bot.policy.decide(context({ ...observation, roomId: 'other-room' }))
    const afterOtherRoom = count.mock.calls.length
    bot.policy.decide(context(observation))
    expect(count.mock.calls.length).toBe(afterOtherRoom)
    vi.mocked(publicDecisions).mockReturnValue([
      { observation, taken: { seat: 0, street: 'river', action: { kind: 'check' } } },
      {
        observation: { ...observation, actor: { ...observation.actor, playerId: 'b', seat: 1 } },
        taken: { seat: 1, street: 'river', action: { kind: 'raiseTo', to: 50 } },
      },
    ])
    bot.policy.decide(
      context({
        ...observation,
        pot: 150,
        currentBet: 50,
        amountToCall: 50,
        opponentStats: [reads(0)],
      }),
    )
    expect(count.mock.calls.length).toBe(afterOtherRoom)
    expect(bot.stats.fallbacks).toEqual({})
    bot.policy.releaseHand(observation.roomId, observation.handNumber)
    vi.mocked(publicDecisions).mockReturnValue([])
    bot.policy.decide(context(observation))
    expect(count.mock.calls.length).toBeGreaterThan(afterOtherRoom)
  })

  it.each([false, true])('uses baseline-relative caps only when enabled (%s)', (baselineCaps) => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const lowCarry: RiverCarrySource = (...args) => {
      const inherited = carry(...args)
      if (inherited === null) throw new Error('missing carry')
      return { ...inherited, gadget: { player: 1, promises: Float64Array.of(99) } }
    }
    const bot = riverSolverPolicy(
      alwaysCallPolicy,
      'test',
      1,
      { ...tuning, boundedReads: true, baselineCaps },
      undefined,
      undefined,
      lowCarry,
    )
    bot.policy.decide(context(view()))
    expect(bot.stats.baselineViolations).toBe(1)
    expect(bot.stats.adaptationProposals).toBe(Number(baselineCaps))
    if (baselineCaps) expect(bot.stats.maxCapViolation).toBeLessThanOrEqual(1e-6)
  })

  it('leaves the carried v9g river identical with the flag omitted or explicitly off', () => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const count = vi.spyOn(solver, 'solveRiver')
    const old = riverSolverPolicy(alwaysCallPolicy, 'test', 1, tuning, undefined, undefined, carry)
    const off = riverSolverPolicy(
      alwaysCallPolicy,
      'test',
      1,
      { ...tuning, boundedReads: false },
      undefined,
      undefined,
      carry,
    )
    for (let seed = 0; seed < 50; seed++)
      expect(off.policy.decide(context(view(), seed))).toEqual(
        old.policy.decide(context(view(), seed)),
      )
    expect(count.mock.calls).toHaveLength(2)
    expect(count.mock.calls.every((call) => call[2] === undefined && call[4] !== undefined)).toBe(
      true,
    )
    expect(old.stats.adaptationChecks + off.stats.adaptationChecks).toBe(0)
  })
})
