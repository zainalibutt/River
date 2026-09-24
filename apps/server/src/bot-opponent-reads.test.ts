import {
  type BotObservationV1,
  type BotOpponentStatsV2,
  type BotPolicyContextV1,
  mulberry32,
  normalizeBotTilt,
  parseCard,
  personalityPool,
  rateEstimate,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  leakFreeControlPolicy,
  opponentReadPolicy,
  opponentStatsPlugin,
  readDecision,
} from './bot-opponent-reads.js'
import { legacyGuardPolicy, pokerGuardPolicy } from './bot-poker-guard.js'
import { observationFor, profileFor } from './bot-service.js'
import { runSessions } from './bot-session-benchmark.js'
import { focalRotation, ordinaryTables } from './bot-session-campaign.js'
import { pairRuns } from './bot-session-evaluation.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const tuning = { priorStrength: 10, intervalZ: 1.645 }

function stats(
  playerId: string,
  rates: { foldToBet?: [number, number]; betWhenCheckedTo?: [number, number] },
): BotOpponentStatsV2 {
  const rate = (pair: [number, number] | undefined, prior: number) =>
    rateEstimate(pair?.[0] ?? 0, pair?.[1] ?? 0, prior, tuning)
  return {
    playerId,
    version: 2,
    hands: 50,
    vpip: rate(undefined, 0.3),
    pfr: rate(undefined, 0.18),
    foldToPreflopRaise: rate(undefined, 0.5),
    foldToBet: rate(rates.foldToBet, 0.4),
    raiseVsBet: rate(undefined, 0.1),
    betWhenCheckedTo: rate(rates.betWhenCheckedTo, 0.35),
    riverBetWhenCheckedTo: rate(undefined, 0.3),
    betSizes: { small: 0, medium: 0, large: 0 },
    shownRiverAggression: { air: 0, pair: 0, made: 0 },
  }
}

function spot(options: {
  hole: string
  board: string
  facing: number
  opponents?: number
  opponentStats?: readonly BotOpponentStatsV2[]
}): BotObservationV1 {
  const others = options.opponents ?? 1
  return {
    version: 1,
    roomId: 'reads',
    handNumber: 1,
    actor: {
      playerId: 'bot:kazimir',
      seat: 0,
      hole: cards(options.hole),
      stack: 50_000,
      betHand: 4_000,
      betStreet: 0,
    },
    street: 'river',
    board: cards(options.board),
    dealerSeat: 1,
    pot: 8_000 + options.facing,
    currentBet: options.facing,
    amountToCall: options.facing,
    legal: {
      fold: options.facing > 0,
      check: options.facing === 0,
      call: { enabled: options.facing > 0, amount: options.facing },
      raiseTo: { enabled: true, min: Math.max(500, options.facing * 2), max: 50_000 },
      allIn: { enabled: true, amount: 50_000 },
    },
    seats: [
      {
        seat: 0,
        playerId: 'bot:kazimir',
        stack: 50_000,
        betHand: 4_000,
        betStreet: 0,
        folded: false,
        allIn: false,
        away: false,
      },
      ...Array.from({ length: others }, (_, index) => ({
        seat: index + 1,
        playerId: `bot:other-${index}`,
        stack: 50_000,
        betHand: 4_000 + options.facing,
        betStreet: options.facing,
        folded: false,
        allIn: false,
        away: false,
      })),
    ],
    opponents: [],
    ...(options.opponentStats === undefined ? {} : { opponentStats: options.opponentStats }),
    tilt: normalizeBotTilt(undefined),
  }
}

const board = 'Kh 9d 5c 2s 3h'

describe('what a read may change', () => {
  it('calls a bet with a pair only once an opponent is established as betting most spots', () => {
    const aggressive = [stats('bot:other-0', { betWhenCheckedTo: [38, 40] })]
    const facing = { hole: 'Ks 7c', board, facing: 3_000 }
    expect(readDecision(spot({ ...facing, opponentStats: aggressive }), { kind: 'fold' })).toEqual({
      rule: 'bluff-catch',
      decision: { kind: 'call' },
    })
    const early = [stats('bot:other-0', { betWhenCheckedTo: [5, 5] })]
    expect(readDecision(spot({ ...facing, opponentStats: early }), { kind: 'fold' })).toBeNull()
    const ordinary = [stats('bot:other-0', { betWhenCheckedTo: [14, 40] })]
    expect(readDecision(spot({ ...facing, opponentStats: ordinary }), { kind: 'fold' })).toBeNull()
    expect(
      readDecision(spot({ ...facing, opponents: 2, opponentStats: aggressive }), { kind: 'fold' }),
    ).toBeNull()
    expect(
      readDecision(spot({ ...facing, hole: 'Qs Jc', opponentStats: aggressive }), { kind: 'fold' }),
    ).toBeNull()
  })

  it('bluffs a pot-sized bet only into an established folder, and value-bets a station', () => {
    const folder = [stats('bot:other-0', { foldToBet: [38, 40] })]
    const station = [stats('bot:other-0', { foldToBet: [1, 40] })]
    const unknown = [stats('bot:other-0', { foldToBet: [3, 4] })]
    const air = { hole: 'Qs Jc', board, facing: 0 }
    const pair = { hole: 'Ks 7c', board, facing: 0 }
    expect(readDecision(spot({ ...air, opponentStats: folder }), { kind: 'check' })).toEqual({
      rule: 'fold-equity-bluff',
      decision: { kind: 'raiseTo', to: 8_000 },
    })
    expect(readDecision(spot({ ...air, opponentStats: station }), { kind: 'check' })).toBeNull()
    expect(readDecision(spot({ ...air, opponentStats: unknown }), { kind: 'check' })).toBeNull()
    expect(readDecision(spot({ ...pair, opponentStats: station }), { kind: 'check' })).toEqual({
      rule: 'station-value',
      decision: { kind: 'raiseTo', to: 4_000 },
    })
    expect(readDecision(spot({ ...pair, opponentStats: folder }), { kind: 'check' })).toBeNull()
  })

  it('never reads without public statistics, and never for a rookie or novice', () => {
    expect(readDecision(spot({ hole: 'Ks 7c', board, facing: 3_000 }), { kind: 'fold' })).toBeNull()
    const cast = personalityPool()
    const novice = cast[4]
    if (novice === undefined) throw new Error('cast missing')
    const observation = spot({
      hole: 'Ks 7c',
      board,
      facing: 3_000,
      opponentStats: [stats('bot:other-0', { betWhenCheckedTo: [38, 40] })],
    })
    const context: BotPolicyContextV1 = {
      observation,
      profile: profileFor(novice),
      personality: novice,
      tilt: observation.tilt,
      rng: mulberry32(7),
    }
    const reads: string[] = []
    const candidate = opponentReadPolicy({ onRead: (rule) => reads.push(rule) })
    expect(candidate.decide(context).decision).toEqual(
      leakFreeControlPolicy.decide({ ...context, rng: mulberry32(7) }).decision,
    )
    expect(reads).toEqual([])
  })
})

describe('leak-free control', () => {
  it('never raises air into a bet for an OG, where the version 4 policy sometimes did', () => {
    const og = personalityPool()[11]
    if (og === undefined) throw new Error('cast missing')
    const observation = spot({ hole: 'Qs Jc', board, facing: 3_000 })
    let legacy = 0
    let live = 0
    let control = 0
    for (let seed = 0; seed < 300; seed += 1) {
      const context: BotPolicyContextV1 = {
        observation,
        profile: profileFor(og),
        personality: og,
        tilt: observation.tilt,
        rng: mulberry32(seed),
      }
      if (legacyGuardPolicy.decide(context).decision.kind === 'raiseTo') legacy += 1
      if (
        pokerGuardPolicy.decide({ ...context, rng: mulberry32(seed) }).decision.kind === 'raiseTo'
      ) {
        live += 1
      }
      if (
        leakFreeControlPolicy.decide({ ...context, rng: mulberry32(seed) }).decision.kind ===
        'raiseTo'
      ) {
        control += 1
      }
    }
    expect(legacy).toBeGreaterThan(0)
    expect(control).toBe(0)
    expect(live).toBe(0)
  })
})

describe('unknown-style fallback over whole sessions', () => {
  it('plays exactly like the control while no read is established', () => {
    const table = ordinaryTables()[1]
    if (table === undefined) throw new Error('table missing')
    const common = {
      seed: 'reads-fallback',
      sessions: 3,
      handsPerSession: 20,
      table,
      focalPersonalities: focalRotation(),
    }
    const reads: string[] = []
    const control = runSessions({ ...common, focalPolicy: leakFreeControlPolicy })
    const candidate = runSessions({
      ...common,
      focalPolicy: opponentReadPolicy({ onRead: (rule) => reads.push(rule) }),
      plugin: opponentStatsPlugin(),
    })
    expect(reads).toEqual([])
    expect(pairRuns(control.hands, candidate.hands).every((pair) => pair.deltaChips === 0)).toBe(
      true,
    )
  })

  it('passes public statistics only for seated opponents, as copies', () => {
    const table = ordinaryTables()[0]
    if (table === undefined) throw new Error('table missing')
    const seated = stats('bot:other-0', { foldToBet: [1, 40] })
    const stranger = stats('bot:not-here', { foldToBet: [1, 40] })
    const observation = observationFor(
      {
        venueId: 'rooftop',
        handNumber: 1,
        phase: 'hand',
        street: 'river',
        board: cards(board),
        pot: 8_000,
        currentBet: 0,
        countdownMs: 0,
        seats: [
          {
            seat: 0,
            playerId: 'bot:kazimir',
            name: 'Kazimir',
            stack: 50_000,
            betHand: 4_000,
            betStreet: 0,
            folded: false,
            allIn: false,
            hole: cards('Ks 7c'),
            hasHole: true,
            sittingOut: false,
            busted: false,
            disconnected: false,
            dealer: true,
          },
          {
            seat: 1,
            playerId: 'bot:other-0',
            name: 'Other',
            stack: 50_000,
            betHand: 4_000,
            betStreet: 0,
            folded: false,
            allIn: false,
            hole: null,
            hasHole: true,
            sittingOut: false,
            busted: false,
            disconnected: false,
            dealer: false,
          },
        ],
        currentActor: { playerId: 'bot:kazimir', seat: 0 },
        legal: {
          fold: { enabled: false, amount: 0 },
          check: { enabled: true, amount: 0 },
          call: { enabled: false, amount: 0 },
          raiseTo: { enabled: true, min: 500 },
          allIn: { enabled: true, amount: 50_000 },
        },
        turnDeadlineMs: null,
        turnBudgetMs: null,
        commit: null,
        revealedSeed: null,
        clientSeeds: null,
        message: null,
        revealed: false,
        selfId: 'bot:kazimir',
        challenges: [],
        hostPlayerId: '',
        inviteCode: 'RIVER2',
      },
      'bot:kazimir',
      undefined,
      'reads',
      null,
      [],
      [seated, stranger],
    )
    expect(observation?.opponentStats?.map((entry) => entry.playerId)).toEqual(['bot:other-0'])
    expect(observation?.opponentStats?.[0]).not.toBe(seated)
    expect(observation?.opponentStats?.[0]).toEqual(seated)
  })
})
