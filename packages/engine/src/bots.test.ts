import { describe, expect, it } from 'vitest'
import type { BotDecisionInput, BotObservationV1 } from './bots.js'
import {
  BOT_STRATEGY_TUNING,
  decideBotTurn,
  deterministicRulePolicy,
  LEGACY_RULE_STRATEGY,
  rulePolicy,
  summarisePublicActions,
} from './bots.js'
import { parseCard } from './cards.js'
import { BOT_PROFILES } from './config.js'
import { mulberry32 } from './rng.js'

const BASE: BotDecisionInput = {
  street: 'preflop',
  hole: [parseCard('2c'), parseCard('7d')],
  board: [],
  betToCall: 0,
  pot: 750,
  minRaiseTo: 1000,
  currentBet: 500,
  stack: 100_000,
  betThisStreet: 500,
}

function withHole(cards: string): BotDecisionInput {
  const texts = cards.split(' ')
  return { ...BASE, hole: [parseCard(texts[0] ?? ''), parseCard(texts[1] ?? '')] }
}

function riverObservation(actions?: BotObservationV1['actions']): BotObservationV1 {
  return {
    version: 1,
    roomId: 'table-one',
    handNumber: 9,
    actor: {
      playerId: 'bot:albie',
      seat: 2,
      hole: [parseCard('Ah'), parseCard('Qh')],
      stack: 18_200,
      betHand: 0,
      betStreet: 0,
    },
    street: 'river',
    board: ['As', 'Qc', '7d', '3s', '2h'].map(parseCard),
    pot: 4_200,
    currentBet: 1_800,
    amountToCall: 1_800,
    legal: {
      fold: true,
      check: false,
      call: { enabled: true, amount: 1_800 },
      raiseTo: { enabled: true, min: 3_600, max: 18_200 },
      allIn: { enabled: true, amount: 18_200 },
    },
    seats: [],
    opponents: [],
    ...(actions === undefined ? {} : { actions }),
    tilt: { factor: 0 },
  }
}

describe('bot decisions', () => {
  it('wraps the deterministic decision in a versioned policy envelope', () => {
    const observation = {
      version: 1,
      roomId: 'table-one',
      handNumber: 4,
      actor: {
        playerId: 'bot:albie',
        seat: 2,
        hole: withHole('As Ad').hole,
        stack: BASE.stack,
        betHand: BASE.betThisStreet,
        betStreet: BASE.betThisStreet,
      },
      street: BASE.street,
      board: BASE.board,
      pot: BASE.pot,
      currentBet: BASE.currentBet,
      amountToCall: BASE.betToCall,
      legal: {
        fold: true,
        check: true,
        call: { enabled: true, amount: BASE.betToCall },
        raiseTo: { enabled: true, min: BASE.minRaiseTo, max: BASE.stack + BASE.betThisStreet },
        allIn: { enabled: true, amount: BASE.stack },
      },
      seats: [],
      opponents: [],
      tilt: { factor: 0 },
    } satisfies BotObservationV1
    const envelope = deterministicRulePolicy.decide({
      observation,
      profile: BOT_PROFILES.novice,
      personality: {
        id: 'albie',
        name: 'Albie',
        skill: 'novice',
        aggression: 0.3,
        tightness: 0.5,
        bluffRate: 0.1,
        tiltResistance: 0.5,
        chatter: 'silent',
      },
      tilt: { factor: 0 },
      rng: mulberry32(42),
    })
    expect(envelope).toMatchObject({
      policyId: 'deterministic-rule',
      policyVersion: 5,
      observationVersion: 1,
      fallbackReason: null,
    })
  })

  it('are deterministic for a seed and profile', () => {
    const profile = BOT_PROFILES.novice
    const first = decideBotTurn(BASE, profile, mulberry32(42))
    const second = decideBotTurn(BASE, profile, mulberry32(42))
    expect(first).toEqual(second)
  })

  it('check or fold weak hands, raise strong ones', () => {
    const profile = BOT_PROFILES.rookie
    const weak = decideBotTurn(withHole('2c 7d'), profile, mulberry32(1))
    expect(['check', 'fold']).toContain(weak.kind)
    let raised = false
    for (let seed = 0; seed < 30; seed++) {
      const decision = decideBotTurn(withHole('As Ad'), profile, mulberry32(seed))
      if (decision.kind !== 'check') {
        raised = true
        break
      }
    }
    expect(raised).toBe(true)
  })

  it('never raises below the minimum raise', () => {
    for (const profile of Object.values(BOT_PROFILES)) {
      for (let seed = 0; seed < 50; seed++) {
        const decision = decideBotTurn(BASE, profile, mulberry32(seed))
        if (decision.kind === 'raiseTo') {
          expect(decision.to).toBeGreaterThanOrEqual(BASE.minRaiseTo)
        }
        if (decision.kind === 'allIn') {
          expect(BASE.stack + BASE.betThisStreet).toBeGreaterThan(BASE.currentBet)
        }
      }
    }
  })

  it('presents distinct behaviour across skills', () => {
    const weakFacing = { ...withHole('2c 7d'), betToCall: 500, pot: 1000 }
    const countCalls = (skill: keyof typeof BOT_PROFILES): number =>
      Array.from({ length: 200 }, (_, seed) =>
        decideBotTurn(weakFacing, BOT_PROFILES[skill], mulberry32(seed)),
      ).filter((decision) => decision.kind === 'call').length
    expect(countCalls('rookie')).toBeGreaterThan(countCalls('og'))
  })

  it('changes decisions by skill even with the same personality thresholds', () => {
    const weakFacing = { ...withHole('2c 7d'), betToCall: 500, pot: 1_000 }
    const base = {
      ...BOT_PROFILES.novice,
      bluffRate: 0,
      looseness: 1,
      callFloor: 0.8,
      rerollFloor: 0.9,
    }
    const calls = (skill: 'rookie' | 'novice' | 'og') =>
      Array.from({ length: 200 }, (_, seed) =>
        decideBotTurn(weakFacing, { ...base, skill }, mulberry32(seed)),
      ).filter((decision) => decision.kind === 'call').length
    expect(calls('rookie')).toBeGreaterThan(calls('novice'))
    expect(calls('novice')).toBeGreaterThan(calls('og'))
  })

  it('uses all-in rather than an unreachable short-stack raise', () => {
    const short = {
      ...withHole('As Ad'),
      betToCall: 500,
      pot: 2000,
      minRaiseTo: 1500,
      currentBet: 1000,
      stack: 400,
      betThisStreet: 0,
    }
    for (let seed = 0; seed < 20; seed++) {
      const decision = decideBotTurn(short, BOT_PROFILES.og, mulberry32(seed))
      expect(decision.kind).not.toBe('raiseTo')
    }
  })

  it('raises with a made hand on the river', () => {
    const profile = BOT_PROFILES.novice
    const made = decideBotTurn(
      {
        street: 'river',
        hole: [parseCard('As'), parseCard('Ad')],
        board: [
          parseCard('Ks'),
          parseCard('Kd'),
          parseCard('9c'),
          parseCard('5h'),
          parseCard('2s'),
        ],
        betToCall: 0,
        pot: 3000,
        minRaiseTo: 1500,
        currentBet: 0,
        stack: 90_000,
        betThisStreet: 0,
      },
      profile,
      mulberry32(3),
    )
    expect(['raiseTo', 'check', 'allIn']).toContain(made.kind)
  })

  it('summarises repeated public aggression without inventing hidden-card meaning', () => {
    const summary = summarisePublicActions(
      [
        {
          seat: 0,
          street: 'flop',
          action: { kind: 'raiseTo', to: 900 },
          amountCommitted: 900,
          potBefore: 1_200,
          streetBetAfter: 900,
        },
        {
          seat: 2,
          street: 'flop',
          action: { kind: 'call' },
          amountCommitted: 900,
          potBefore: 2_100,
          streetBetAfter: 900,
        },
        {
          seat: 0,
          street: 'turn',
          action: { kind: 'raiseTo', to: 1_800 },
          amountCommitted: 1_800,
          potBefore: 3_000,
          streetBetAfter: 1_800,
        },
        {
          seat: 0,
          street: 'river',
          action: { kind: 'raiseTo', to: 3_600 },
          amountCommitted: 3_600,
          potBefore: 4_800,
          streetBetAfter: 3_600,
        },
      ],
      'river',
    )
    expect(summary).toEqual({
      lastAggressorSeat: 0,
      raisesThisStreet: 1,
      lastAggressivePotRatio: 0.75,
      consecutiveAggressiveStreets: 3,
    })
    expect(summary).not.toHaveProperty('handStrength')
    expect(summary).not.toHaveProperty('isBluff')
  })

  it('does not mistake an all-in call for a raise', () => {
    const summary = summarisePublicActions(
      [
        {
          seat: 0,
          street: 'river',
          action: { kind: 'raiseTo', to: 4_000 },
          amountCommitted: 4_000,
          potBefore: 5_000,
          streetBetAfter: 4_000,
        },
        {
          seat: 1,
          street: 'river',
          action: { kind: 'allIn' },
          amountCommitted: 4_000,
          potBefore: 9_000,
          streetBetAfter: 4_000,
        },
      ],
      'river',
    )
    expect(summary.lastAggressorSeat).toBe(0)
    expect(summary.raisesThisStreet).toBe(1)
  })

  it('makes OG more cautious with a marginal hand after sustained large public bets', () => {
    const actions = [
      {
        seat: 0,
        street: 'turn' as const,
        action: { kind: 'raiseTo' as const, to: 1_500 },
        amountCommitted: 1_500,
        potBefore: 2_000,
        streetBetAfter: 1_500,
      },
      {
        seat: 0,
        street: 'river' as const,
        action: { kind: 'raiseTo' as const, to: 1_800 },
        amountCommitted: 1_800,
        potBefore: 2_400,
        streetBetAfter: 1_800,
      },
    ]
    const decisions = (observation: BotObservationV1) =>
      Array.from(
        { length: 200 },
        (_, seed) =>
          deterministicRulePolicy.decide({
            observation,
            profile: BOT_PROFILES.og,
            personality: {
              id: 'albie',
              name: 'Albie',
              skill: 'og',
              aggression: 0.5,
              tightness: 0.5,
              bluffRate: 0,
              tiltResistance: 0.9,
              chatter: 'silent',
            },
            tilt: { factor: 0 },
            rng: mulberry32(seed),
          }).decision,
      )
    const ordinaryFolds = decisions(riverObservation()).filter(
      (decision) => decision.kind === 'fold',
    ).length
    const pressuredFolds = decisions(riverObservation(actions)).filter(
      (decision) => decision.kind === 'fold',
    ).length
    expect(pressuredFolds).toBeGreaterThan(ordinaryFolds)
  })

  it('uses only confident opponent tendencies to soften a marginal fold', () => {
    const actions = [
      {
        seat: 0,
        street: 'river' as const,
        action: { kind: 'raiseTo' as const, to: 1_800 },
        amountCommitted: 1_800,
        potBefore: 2_400,
        streetBetAfter: 1_800,
      },
    ]
    const looseOpponent = {
      version: 1 as const,
      playerId: 'player-0',
      sampleCount: 40,
      confidence: 0.86,
      vpip: 0.62,
      pfr: 0.34,
      aggressionFrequency: 0.8,
      showdownFrequency: 0.1,
      averageAggressivePotRatio: 0.9,
    }
    const decisions = (
      opponents: BotObservationV1['opponents'],
      skill: 'rookie' | 'novice' | 'og' = 'og',
    ) =>
      Array.from(
        { length: 200 },
        (_, seed) =>
          deterministicRulePolicy.decide({
            observation: {
              ...riverObservation(actions),
              seats: [
                {
                  seat: 0,
                  playerId: 'player-0',
                  stack: 18_200,
                  betHand: 0,
                  betStreet: 1_800,
                  folded: false,
                  allIn: false,
                  away: false,
                },
                {
                  seat: 2,
                  playerId: 'bot:albie',
                  stack: 18_200,
                  betHand: 0,
                  betStreet: 0,
                  folded: false,
                  allIn: false,
                  away: false,
                },
              ],
              opponents,
            },
            profile: BOT_PROFILES[skill],
            personality: {
              id: 'albie',
              name: 'Albie',
              skill,
              aggression: 0.5,
              tightness: 0.5,
              bluffRate: 0,
              tiltResistance: 0.9,
              chatter: 'silent',
            },
            tilt: { factor: 0 },
            rng: mulberry32(seed),
          }).decision,
      )
    const calls = (opponents: BotObservationV1['opponents']) =>
      decisions(opponents).filter((decision) => decision.kind === 'call').length
    expect(calls([looseOpponent])).toBeGreaterThan(calls([]))
    expect(calls([{ ...looseOpponent, confidence: 0.1 }])).toBe(calls([]))
    expect(decisions([looseOpponent], 'novice')).toEqual(decisions([], 'novice'))
    expect(BOT_STRATEGY_TUNING.opponentRead.maxCallFloorAdjustment).toBeLessThanOrEqual(0.05)
  })
})

describe('skilled bluffing for an OG', () => {
  const facingOnFlop = (hole: string, board: string): BotDecisionInput => ({
    street: 'flop',
    hole: hole.split(' ').map(parseCard),
    board: board.split(' ').map(parseCard),
    betToCall: 2_000,
    pot: 6_000,
    minRaiseTo: 4_000,
    currentBet: 2_000,
    stack: 60_000,
    betThisStreet: 0,
  })
  const og = { ...BOT_PROFILES.og, bluffRate: 0.4 }
  const raises = (input: BotDecisionInput, mode: 'any-hand' | 'with-equity' | 'never') => {
    let count = 0
    for (let seed = 0; seed < 400; seed += 1) {
      const decision = decideBotTurn(input, og, mulberry32(seed), undefined, mode)
      if (decision.kind === 'raiseTo' || decision.kind === 'allIn') count += 1
    }
    return count
  }

  it('keeps the legacy any-hand raise unless another mode is chosen', () => {
    const air = facingOnFlop('Qs 3c', 'Kh 9d 5c')
    expect(raises(air, 'any-hand')).toBeGreaterThan(100)
    expect(raises(air, 'with-equity')).toBe(0)
    expect(raises(air, 'never')).toBe(0)
  })

  it('raises a draw at the bluff rate only with equity, sized as a real raise', () => {
    const draw = facingOnFlop('Ah 4h', 'Kh 9h 2c')
    expect(raises(draw, 'with-equity')).toBeGreaterThan(100)
    expect(raises(draw, 'never')).toBe(0)
    const decision = decideBotTurn(draw, og, mulberry32(3), undefined, 'with-equity')
    if (decision.kind === 'raiseTo') expect(decision.to).toBeGreaterThan(draw.minRaiseTo + 100)
  })
})

describe('checked-to bluffs for a heads-up OG', () => {
  const observation = (street: 'turn' | 'river', others: number): BotObservationV1 => ({
    version: 1,
    roomId: 'table-two',
    handNumber: 4,
    actor: {
      playerId: 'bot:kazimir',
      seat: 0,
      hole: [parseCard('Qs'), parseCard('Jc')],
      stack: 50_000,
      betHand: 3_000,
      betStreet: 0,
    },
    street,
    board: (street === 'turn' ? 'Kh 9d 5c 2s' : 'Kh 9d 5c 2s 3h').split(' ').map(parseCard),
    dealerSeat: 1,
    pot: 6_000,
    currentBet: 0,
    amountToCall: 0,
    legal: {
      fold: false,
      check: true,
      call: { enabled: false, amount: 0 },
      raiseTo: { enabled: true, min: 500, max: 50_000 },
      allIn: { enabled: true, amount: 50_000 },
    },
    seats: Array.from({ length: others + 1 }, (_, seat) => ({
      seat,
      playerId: seat === 0 ? 'bot:kazimir' : `bot:other-${seat}`,
      stack: 50_000,
      betHand: 3_000,
      betStreet: 0,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    tilt: { factor: 0 },
  })
  const bets = (
    policy: ReturnType<typeof rulePolicy>,
    spot: BotObservationV1,
    skill: 'og' | 'rookie',
  ) => {
    let count = 0
    for (let seed = 0; seed < 400; seed += 1) {
      const decision = policy.decide({
        observation: spot,
        profile: { ...BOT_PROFILES[skill], bluffRate: 0.4 },
        personality: {
          id: 'kazimir',
          name: 'Kazimir',
          skill,
          aggression: 0.5,
          tightness: 0.3,
          bluffRate: 0.4,
          tiltResistance: 0.7,
          chatter: 'silent',
        },
        tilt: { factor: 0 },
        rng: mulberry32(seed),
      }).decision
      if (decision.kind === 'raiseTo') count += 1
    }
    return count
  }
  const checked = rulePolicy('checked-test', 1, { ...LEGACY_RULE_STRATEGY, checkedBluffs: true })

  it('bets air on the river heads-up at a share of the bluff rate, never multiway or for a rookie', () => {
    const headsUp = bets(checked, observation('river', 1), 'og')
    expect(headsUp).toBeGreaterThan(40)
    expect(headsUp).toBeLessThan(140)
    expect(bets(checked, observation('river', 2), 'og')).toBe(0)
    expect(bets(checked, observation('river', 1), 'rookie')).toBe(0)
    expect(bets(deterministicRulePolicy, observation('river', 1), 'og')).toBe(0)
  })
})
