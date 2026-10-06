import {
  type BotObservationV1,
  type BotPolicyContextV1,
  HandCategory,
  mulberry32,
  normalizeBotTilt,
  parseCard,
  personalityPool,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { runBotBenchmark } from './bot-benchmark.js'
import { riverBetProbability } from './bot-river-scenarios.js'
import { profileFor } from './bot-service.js'
import {
  HELD_OUT_STYLES,
  heldOutStylePolicy,
  preflopThresholdForShare,
  streetBucket,
} from './bot-style-opponents.js'

const personality = personalityPool()[0]
if (personality === undefined) throw new Error('cast missing')

function riverSpot(hole: string[], board: string[]): BotObservationV1 {
  return {
    version: 1,
    roomId: 'style-test',
    handNumber: 1,
    actor: {
      playerId: 'bot:albie',
      seat: 0,
      hole: hole.map(parseCard),
      stack: 40_000,
      betHand: 5_000,
      betStreet: 0,
    },
    street: 'river',
    board: board.map(parseCard),
    dealerSeat: 1,
    pot: 10_000,
    currentBet: 0,
    amountToCall: 0,
    legal: {
      fold: false,
      check: true,
      call: { enabled: false, amount: 0 },
      raiseTo: { enabled: true, min: 500, max: 40_000 },
      allIn: { enabled: true, amount: 40_000 },
    },
    seats: [],
    opponents: [],
    tilt: normalizeBotTilt(undefined),
  }
}

function decide(
  style: (typeof HELD_OUT_STYLES)[number],
  observation: BotObservationV1,
  seed: number,
) {
  const context: BotPolicyContextV1 = {
    observation,
    profile: profileFor(personality as NonNullable<typeof personality>),
    personality: personality as NonNullable<typeof personality>,
    tilt: observation.tilt,
    rng: mulberry32(seed),
  }
  return heldOutStylePolicy(style).decide(context).decision
}

const board = ['Kh', '9d', '5c', '2s', '3h']
const air = riverSpot(['Qs', 'Jc'], board)
const pair = riverSpot(['Ks', '7c'], board)
const twoPair = riverSpot(['Ks', '9c'], board)

function betRate(style: (typeof HELD_OUT_STYLES)[number], spot: BotObservationV1): number {
  let bets = 0
  for (let seed = 0; seed < 400; seed += 1) {
    if (decide(style, spot, seed).kind !== 'check') bets += 1
  }
  return bets / 400
}

describe('held-out whole-hand styles', () => {
  it('classifies a street from the actor’s own cards and the public board', () => {
    expect(streetBucket(air.actor.hole, board.map(parseCard))).toBe('air')
    expect(streetBucket(pair.actor.hole, board.map(parseCard))).toBe('pair')
    expect(streetBucket(twoPair.actor.hole, board.map(parseCard))).toBe('strong')
    expect(streetBucket(['Ah', '4h'].map(parseCard), ['Kh', '9h', '2c'].map(parseCard))).toBe(
      'draw',
    )
  })

  it('bets the river as often as the river scenario tables say, per style and hand', () => {
    for (const style of HELD_OUT_STYLES) {
      expect(betRate(style, air)).toBeCloseTo(riverBetProbability(style, HandCategory.HIGH_CARD), 1)
      expect(betRate(style, pair)).toBeCloseTo(riverBetProbability(style, HandCategory.PAIR), 1)
      expect(betRate(style, twoPair)).toBeCloseTo(
        riverBetProbability(style, HandCategory.TWO_PAIR),
        1,
      )
    }
  })

  it('sizes value small and bluffs large only for the reverse-sizing player', () => {
    const sizes = (style: (typeof HELD_OUT_STYLES)[number], spot: BotObservationV1) => {
      const amounts: number[] = []
      for (let seed = 0; seed < 400; seed += 1) {
        const decision = decide(style, spot, seed)
        if (decision.kind === 'raiseTo') amounts.push(decision.to)
      }
      return amounts.reduce((sum, value) => sum + value, 0) / Math.max(1, amounts.length)
    }
    expect(sizes('reverse-sizing', twoPair)).toBeLessThan(sizes('reverse-sizing', air))
    expect(sizes('balanced', twoPair)).toBeGreaterThan(sizes('balanced', air))
  })

  it('turns a share of starting hands into a score threshold from the measured distribution', () => {
    expect(preflopThresholdForShare(1)).toBe(0)
    expect(preflopThresholdForShare(0.25)).toBeCloseTo(0.458, 3)
    expect(preflopThresholdForShare(0.7)).toBeLessThan(preflopThresholdForShare(0.17))
    expect(() => preflopThresholdForShare(0)).toThrow()
  })

  it('plays complete legal hands at a nine-seat table', () => {
    const cast = personalityPool()
    const seats = HELD_OUT_STYLES.map((style, index) => ({
      personality: cast[index] as NonNullable<(typeof cast)[number]>,
      policy: heldOutStylePolicy(style),
    }))
    const ordinary = cast.slice(5, 9).map((entry) => ({ personality: entry }))
    const result = runBotBenchmark({
      seed: 'style-legal',
      hands: 12,
      seats: [...seats, ...ordinary],
    })
    expect(result.results).toHaveLength(12)
    expect(result.seats.reduce((sum, seat) => sum + seat.netChips, 0)).toBe(0)
  })
})
