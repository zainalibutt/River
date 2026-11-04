import {
  type BotObservationV1,
  type BotPolicyContextV1,
  mulberry32,
  parseCard,
  personalityPool,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import * as river from './bot-river-policy.js'
import { profileFor } from './bot-service.js'
import { predictableHybridPolicy } from './bot-turn-policy.js'

function context(
  street: BotObservationV1['street'] = 'turn',
  handNumber = 1,
  roomId = 'room',
): BotPolicyContextV1 {
  const board = ['Qs', '9h', '6d', '2c', '3s']
    .slice(0, street === 'river' ? 5 : street === 'flop' ? 3 : 4)
    .map(parseCard)
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
    street: 'turn',
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

  const personality = personalityPool()[10]
  if (personality === undefined) throw new Error('missing test personality')
  return {
    observation: { ...observation, street, handNumber, roomId },
    personality,
    profile: profileFor(personality),
    tilt: observation.tilt,
    rng: mulberry32(42),
  }
}
function setup(threshold: number) {
  const chain = {
    ...pokerGuardPolicy,
    decide: vi.fn(pokerGuardPolicy.decide),
    releaseHand: vi.fn(),
  }
  const exploit = {
    ...pokerGuardPolicy,
    decide: vi.fn(pokerGuardPolicy.decide),
    releaseHand: vi.fn(),
  }
  const hybrid = predictableHybridPolicy(chain, exploit, threshold)
  return { ...hybrid, chain, exploit }
}
function trust(value: number | null) {
  return vi
    .spyOn(river, 'riverReads')
    .mockReturnValue(value === null ? null : ({ trust: value } as river.RiverReads))
}
afterEach(() => vi.restoreAllMocks())
describe.each([0.35, 0.5])('v9g hybrid threshold %s', (threshold) => {
  it('preserves the chain below threshold, including absent reads, on both streets', () => {
    const read = trust(null)
    const { policy, stats, chain, exploit } = setup(threshold)
    for (const value of [null, threshold - 0.001]) {
      read.mockReturnValue(value === null ? null : ({ trust: value } as river.RiverReads))
      for (const street of ['turn', 'river'] as const) {
        expect(policy.decide(context(street))).toEqual(pokerGuardPolicy.decide(context(street)))
      }
    }
    expect(chain.decide).toHaveBeenCalledTimes(4)
    expect(exploit.decide).not.toHaveBeenCalled()
    expect(stats).toEqual({ switches: 0, turn: 0, river: 0 })
  })
  it('switches at threshold, stays switched through the river, and counts only once', () => {
    const read = trust(threshold)
    const { policy, stats, chain, exploit } = setup(threshold)
    policy.decide(context('flop'))
    expect(exploit.decide).not.toHaveBeenCalled()
    policy.decide(context())
    read.mockReturnValue(null)
    policy.decide(context())
    policy.decide(context('river'))
    expect(chain.decide).toHaveBeenCalledTimes(1)
    expect(exploit.decide).toHaveBeenCalledTimes(3)
    expect(stats).toEqual({ switches: 1, turn: 1, river: 0 })
    policy.decide(context('turn', 2))
    expect(chain.decide).toHaveBeenCalledTimes(2)
  })
  it('can first switch on the river and isolates overlapping rooms and settled hands', () => {
    const read = trust(threshold + 0.001)
    const { policy, stats, chain, exploit } = setup(threshold)
    policy.decide(context('river'))
    read.mockReturnValue(null)
    policy.decide(context('river', 1, 'other'))
    policy.decide(context('river'))
    expect(chain.decide).toHaveBeenCalledTimes(1)
    expect(exploit.decide).toHaveBeenCalledTimes(2)
    policy.releaseHand('room', 1)
    expect(chain.releaseHand).toHaveBeenCalledWith('room', 1)
    expect(exploit.releaseHand).toHaveBeenCalledWith('room', 1)
    policy.decide(context('river'))
    expect(chain.decide).toHaveBeenCalledTimes(2)
    expect(stats).toEqual({ switches: 1, turn: 0, river: 1 })
  })
})

it('never switches for non-OG or multiway observations despite trusted reads', () => {
  trust(1)
  const { policy, stats, exploit } = setup(0.35)
  const ctx = context()
  policy.decide({ ...ctx, profile: { ...ctx.profile, skill: 'novice' } })
  const seat = ctx.observation.seats[1]
  if (seat === undefined) throw new Error('missing opponent')
  const extra = { ...seat, seat: 2, playerId: 'c' }
  policy.decide({
    ...ctx,
    observation: { ...ctx.observation, seats: [...ctx.observation.seats, extra] },
  })
  expect(stats.switches).toBe(0)
  expect(exploit.decide).not.toHaveBeenCalled()
})
