import type { BotPersonality, BotPolicy } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  actionFor,
  botPlayerId,
  botsForTable,
  botsIn,
  botsWanted,
  decisionInputFor,
  emptySeatsIn,
  humansIn,
  isBotPlayer,
  observationFor,
  peekAfterDealMs,
  peekDuringThinkMs,
  profileFor,
  type ThinkingSituation,
  thinkingMs,
} from './bot-service.js'
import type { RoomSeatView, RoomView } from './protocol.js'

const TIGHT: BotPersonality = {
  id: 'tight',
  name: 'Tight Tom',
  skill: 'og',
  aggression: 0.2,
  tightness: 1,
  bluffRate: 0,
  tiltResistance: 0.9,
  chatter: 'silent',
}

const LOOSE: BotPersonality = {
  id: 'loose',
  name: 'Loose Lou',
  skill: 'rookie',
  aggression: 0.9,
  tightness: 0,
  bluffRate: 0.2,
  tiltResistance: 0.1,
  chatter: 'constant',
}

function seat(overrides: Partial<RoomSeatView> = {}): RoomSeatView {
  return {
    seat: 0,
    playerId: null,
    name: null,
    stack: 0,
    betHand: 0,
    betStreet: 0,
    folded: false,
    allIn: false,
    hole: null,
    hasHole: false,
    sittingOut: false,
    busted: false,
    disconnected: false,
    dealer: false,
    ...overrides,
  }
}

function view(overrides: Partial<RoomView> = {}): RoomView {
  return {
    venueId: 'rooftop',
    handNumber: 1,
    phase: 'hand',
    street: 'preflop',
    board: [],
    pot: 1_000,
    currentBet: 500,
    countdownMs: 0,
    seats: Array.from({ length: 9 }, (_, index) => seat({ seat: index })),
    currentActor: null,
    legal: null,
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId: 'watcher',
    ...overrides,
  } as RoomView
}

const LEGAL = {
  fold: { enabled: true },
  check: { enabled: false },
  call: { enabled: true, amount: 500 },
  raiseTo: { enabled: true, min: 1_000 },
  allIn: { enabled: true, amount: 20_000 },
}

describe('bot identity', () => {
  it('marks a bot with a prefix a real player id cannot produce', () => {
    expect(isBotPlayer(botPlayerId('albie'))).toBe(true)
    // Everything that touches money keys on a Supabase uuid.
    expect(isBotPlayer('323c30d2-9e36-4c4d-96c8-a315322b113d')).toBe(false)
    expect(isBotPlayer('')).toBe(false)
  })

  it('gives a table the same cast every time, so a reconnect finds it', () => {
    expect(botsForTable('river-one', 4)).toEqual(botsForTable('river-one', 4))
    expect(botsForTable('river-one', 4)).not.toEqual(botsForTable('river-two', 4))
  })

  it('asks for no characters when none are wanted', () => {
    expect(botsForTable('river-one', 0)).toEqual([])
    expect(botsForTable('river-one', -3)).toEqual([])
  })

  it('keeps player-facing strength presets inside their skill bounds', () => {
    expect(botsForTable('river-one', 7, 'casual').every((bot) => bot.skill !== 'og')).toBe(true)
    expect(botsForTable('river-one', 7, 'tough').every((bot) => bot.skill !== 'rookie')).toBe(true)
    expect(new Set(botsForTable('river-one', 7, 'mixed').map((bot) => bot.skill))).toEqual(
      new Set(['rookie', 'novice', 'og']),
    )
  })
})

describe('profileFor', () => {
  it('turns tightness into looseness', () => {
    expect(profileFor(TIGHT).looseness).toBe(0)
    expect(profileFor(LOOSE).looseness).toBe(1)
  })

  it('lets a loose bot call a slightly losing price and a tight one refuse', () => {
    // callFloor is compared against edge, which is strength minus pot odds and
    // can be negative. A positive floor for everyone folds every hand.
    expect(profileFor(LOOSE).callFloor).toBeLessThan(0)
    expect(profileFor(TIGHT).callFloor).toBeGreaterThan(profileFor(LOOSE).callFloor)
  })

  it('keeps the strength floors inside the range strength can reach', () => {
    for (const personality of [TIGHT, LOOSE]) {
      const profile = profileFor(personality)
      expect(profile.raiseFloor).toBeGreaterThan(0)
      expect(profile.raiseFloor).toBeLessThan(1)
      expect(profile.allInFloor).toBeGreaterThan(profile.raiseFloor)
      expect(profile.allInFloor).toBeLessThanOrEqual(1)
    }
  })

  it('carries the character name through as the label', () => {
    expect(profileFor(TIGHT).label).toBe('Tight Tom')
  })

  it('survives a personality with nonsense numbers', () => {
    const broken = { ...TIGHT, aggression: Number.NaN, tightness: 40, bluffRate: -2 }
    const profile = profileFor(broken)
    expect(profile.aggression).toBe(0)
    expect(profile.looseness).toBe(0)
    expect(profile.bluffRate).toBe(0)
  })
})

describe('how many bots a table wants', () => {
  it('seats none at an empty table', () => {
    expect(botsWanted(view(), 5)).toBe(0)
  })

  it('fills up once somebody is sitting', () => {
    const withHuman = view({
      seats: [
        seat({ seat: 0, playerId: 'alice' }),
        ...Array.from({ length: 8 }, (_, i) => seat({ seat: i + 1 })),
      ],
    })
    expect(botsWanted(withHuman, 5)).toBe(5)
  })

  it('always leaves a seat for the next person', () => {
    const busy = view({
      seats: Array.from({ length: 9 }, (_, index) =>
        index < 7 ? seat({ seat: index, playerId: `human-${index}` }) : seat({ seat: index }),
      ),
    })
    // Seven humans, nine seats: one bot, one seat kept free.
    expect(botsWanted(busy, 5)).toBe(1)
  })

  it('does not seat more once the bots are already there', () => {
    const seats = [
      seat({ seat: 0, playerId: 'alice' }),
      seat({ seat: 1, playerId: botPlayerId('albie') }),
      seat({ seat: 2, playerId: botPlayerId('bernadette') }),
      ...Array.from({ length: 6 }, (_, i) => seat({ seat: i + 3 })),
    ]
    expect(botsWanted(view({ seats }), 2)).toBe(0)
    expect(botsIn(view({ seats })).length).toBe(2)
    expect(humansIn(view({ seats }))).toBe(1)
    expect(emptySeatsIn(view({ seats }))).toEqual([3, 4, 5, 6, 7, 8])
  })
})

describe('acting', () => {
  const acting = (overrides: Partial<RoomSeatView> = {}) =>
    view({
      currentActor: { playerId: botPlayerId('loose'), seat: 1 },
      legal: LEGAL as RoomView['legal'],
      seats: [
        seat({ seat: 0, playerId: 'alice', stack: 20_000 }),
        seat({
          seat: 1,
          playerId: botPlayerId('loose'),
          stack: 20_000,
          hole: [
            { rank: 'A', suit: 's' },
            { rank: 'A', suit: 'h' },
          ],
          ...overrides,
        }),
        ...Array.from({ length: 7 }, (_, i) => seat({ seat: i + 2 })),
      ],
    })

  it('refuses to decide when it is not this bot turn', () => {
    expect(decisionInputFor(view(), botPlayerId('loose'))).toBeNull()
  })

  it('refuses to decide when it cannot see its own cards', () => {
    // A bot that guesses at hidden cards is a bot that cheats.
    expect(decisionInputFor(acting({ hole: null }), botPlayerId('loose'))).toBeNull()
  })

  it('builds the amount owed from the street bet, not the hand bet', () => {
    const input = decisionInputFor(acting({ betStreet: 200 }), botPlayerId('loose'))
    expect(input?.betToCall).toBe(300)
  })

  it('builds a private observation with only the actor hole cards', () => {
    const privateView = acting()
    privateView.seats[0] = seat({
      seat: 0,
      playerId: 'alice',
      stack: 20_000,
      hole: [
        { rank: 'K', suit: 's' },
        { rank: 'K', suit: 'h' },
      ],
    })
    const observation = observationFor(
      privateView,
      botPlayerId('loose'),
      { factor: 4 },
      'river-one',
    )
    expect(observation?.actor.hole).toEqual([
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
    ])
    expect(observation?.seats[0]).not.toHaveProperty('hole')
    expect(observation?.opponents).toEqual([
      {
        version: 1,
        playerId: 'alice',
        sampleCount: 0,
        confidence: 0,
        vpip: 0,
        pfr: 0,
        aggressionFrequency: 0,
        showdownFrequency: 0,
        averageAggressivePotRatio: 0,
      },
    ])
    expect(observation?.tilt.factor).toBe(1)
    expect(observation?.actor.hole[0]).not.toBe(privateView.seats[1]?.hole?.[0])
  })

  it('copies current public actions into the policy observation without sharing mutable history', () => {
    const history = [
      {
        seat: 0,
        street: 'preflop' as const,
        action: { kind: 'raiseTo' as const, to: 1_500 },
        amountCommitted: 1_500,
        potBefore: 750,
        streetBetAfter: 1_500,
      },
    ]
    const observation = observationFor(
      acting(),
      botPlayerId('loose'),
      undefined,
      'river-one',
      history,
    )
    if (observation === null) throw new Error('missing observation')
    const seen = observation?.actions?.[0]
    if (seen === undefined || seen.action.kind !== 'raiseTo') throw new Error('missing action')
    expect(seen).toEqual(history[0])
    seen.action.to = 9_000
    seen.amountCommitted = 9_000
    expect(history[0]?.action.to).toBe(1_500)
    expect(history[0]?.amountCommitted).toBe(1_500)
    expect(JSON.stringify(observation.actions)).not.toContain('hole')
    expect(observationFor(acting(), botPlayerId('loose'))).not.toHaveProperty('actions')
  })

  it('passes only supplied summaries for visible opponents into a bot observation', () => {
    const summaries = [
      {
        version: 1 as const,
        playerId: 'alice',
        sampleCount: 12,
        confidence: 0.45,
        vpip: 0.52,
        pfr: 0.28,
        aggressionFrequency: 0.71,
        showdownFrequency: 0.12,
        averageAggressivePotRatio: 0.9,
      },
      {
        version: 1 as const,
        playerId: 'not-seated',
        sampleCount: 99,
        confidence: 0.99,
        vpip: 1,
        pfr: 1,
        aggressionFrequency: 1,
        showdownFrequency: 1,
        averageAggressivePotRatio: 4,
      },
    ]
    const observation = observationFor(
      acting(),
      botPlayerId('loose'),
      undefined,
      'river-one',
      undefined,
      summaries,
    )
    expect(observation?.opponents).toEqual([
      {
        version: 1,
        playerId: 'alice',
        sampleCount: 12,
        confidence: 0.45,
        vpip: 0.52,
        pfr: 0.28,
        aggressionFrequency: 0.71,
        showdownFrequency: 0.12,
        averageAggressivePotRatio: 0.9,
      },
    ])
    const supplied = observation?.opponents[0]
    if (supplied === undefined) throw new Error('missing opponent summary')
    Object.assign(supplied, { vpip: 0 })
    expect(summaries[0]?.vpip).toBe(0.52)
  })

  it('blends injected tilt before a policy receives the profile', () => {
    const aggressions: number[] = []
    const policy: BotPolicy = {
      id: 'profile-recorder',
      version: 1,
      decide(context) {
        aggressions.push(context.profile.aggression)
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: 1,
          decision: { kind: 'fold' },
          fallbackReason: null,
        }
      },
    }
    actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, {
      policy,
      tilt: { factor: 1, cause: 'test' },
    })
    actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, { policy })
    expect(aggressions[0]).toBeGreaterThan(aggressions[1] ?? 1)
    expect(aggressions[1]).toBe(profileFor(LOOSE).aggression)
  })

  it('falls back once and traces an invalid policy envelope without leaking cards', () => {
    const traces: { fallbackReason: string | null; policyId: string; finalAction: string }[] = []
    const invalid: BotPolicy = {
      id: 'invalid',
      version: 1,
      decide: () => ({
        policyId: 'wrong-policy',
        policyVersion: 1,
        observationVersion: 1,
        decision: { kind: 'check' },
        fallbackReason: null,
      }),
    }
    const action = actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, {
      policy: invalid,
      roomId: 'river-one',
      decisionKey: 'decision-one',
      trace: (trace) =>
        traces.push({
          fallbackReason: trace.fallbackReason,
          policyId: trace.policyId,
          finalAction: trace.finalAction.kind,
        }),
    })
    expect(action).not.toBeNull()
    expect(traces).toEqual([
      {
        fallbackReason: 'invalid_envelope',
        policyId: 'deterministic-rule',
        finalAction: expect.any(String),
      },
    ])
  })

  it('rejects a fractional raise from a policy and falls back to the rule policy', () => {
    const traces: { fallbackReason: string | null }[] = []
    const fractional: BotPolicy = {
      id: 'fractional',
      version: 1,
      decide: () => ({
        policyId: 'fractional',
        policyVersion: 1,
        observationVersion: 1,
        decision: { kind: 'raiseTo', to: 1_500.5 },
        fallbackReason: null,
      }),
    }
    const action = actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, {
      policy: fractional,
      trace: (trace) => traces.push({ fallbackReason: trace.fallbackReason }),
    })
    expect(action).not.toBeNull()
    expect(traces).toEqual([{ fallbackReason: 'invalid_envelope' }])
  })

  it('uses the deterministic rule when an injected policy throws', () => {
    const traces: { policyId: string; fallbackReason: string | null }[] = []
    const throwing: BotPolicy = {
      id: 'throwing',
      version: 1,
      decide() {
        throw new Error('model unavailable')
      },
    }
    const action = actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, {
      policy: throwing,
      trace: (trace) =>
        traces.push({ policyId: trace.policyId, fallbackReason: trace.fallbackReason }),
    })
    expect(action).not.toBeNull()
    expect(traces).toEqual([{ policyId: 'deterministic-rule', fallbackReason: 'policy_error' }])
  })

  it('caps a policy raise against the original room stack after observation mutation', () => {
    const corrupting: BotPolicy = {
      id: 'corrupting',
      version: 1,
      decide(context) {
        ;(context.observation.actor as { stack: number }).stack = 1_000_000
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: 1,
          decision: { kind: 'raiseTo', to: 900_000 },
          fallbackReason: null,
        }
      },
    }
    expect(
      actionFor(acting(), botPlayerId('loose'), LOOSE, () => 0.5, { policy: corrupting }),
    ).toEqual({ kind: 'raiseTo', to: 20_000 })
  })

  it('always returns an action the table would accept', () => {
    let counter = 0
    const rng = () => {
      counter += 1
      return (counter % 100) / 100
    }
    for (let round = 0; round < 200; round += 1) {
      const action = actionFor(acting(), botPlayerId('loose'), LOOSE, rng)
      if (action === null) continue
      expect(['fold', 'check', 'call', 'raiseTo', 'allIn']).toContain(action.kind)
      if (action.kind === 'raiseTo') {
        expect(action.to).toBeGreaterThanOrEqual(LEGAL.raiseTo.min)
        expect(action.to).toBeLessThanOrEqual(20_000)
      }
      // Checking is not legal facing a bet, and offering it would be refused.
      expect(action.kind).not.toBe('check')
    }
  })

  it('folds rather than checking when a check is not on offer', () => {
    const noRaise = view({
      currentActor: { playerId: botPlayerId('tight'), seat: 1 },
      legal: {
        fold: { enabled: true },
        check: { enabled: false },
        call: { enabled: false },
        raiseTo: { enabled: false, min: 0 },
        allIn: { enabled: false },
      } as RoomView['legal'],
      seats: [
        seat({ seat: 0, playerId: 'alice' }),
        seat({
          seat: 1,
          playerId: botPlayerId('tight'),
          stack: 100,
          hole: [
            { rank: '2', suit: 's' },
            { rank: '7', suit: 'h' },
          ],
        }),
        ...Array.from({ length: 7 }, (_, i) => seat({ seat: i + 2 })),
      ],
    })
    expect(actionFor(noRaise, botPlayerId('tight'), TIGHT, () => 0.9)).toEqual({ kind: 'fold' })
  })

  it('returns nothing when there are no legal actions to pick from', () => {
    expect(actionFor(view({ legal: null }), botPlayerId('loose'), LOOSE, () => 0.5)).toBeNull()
  })
})

/** A decision with nothing in particular riding on it, to vary one thing at a time. */
function situation(overrides: Partial<ThinkingSituation> = {}): ThinkingSituation {
  return {
    action: 'call',
    street: 'flop',
    betToCall: 200,
    pot: 1_000,
    firstLook: false,
    ...overrides,
  }
}

describe('thinking time', () => {
  it('never answers instantly', () => {
    for (const personality of [TIGHT, LOOSE]) {
      for (const action of ['fold', 'check', 'call', 'raiseTo', 'allIn'] as const) {
        expect(thinkingMs(personality, situation({ action }), () => 0)).toBeGreaterThan(500)
      }
    }
  })

  it('varies, because a constant delay is its own tell', () => {
    expect(thinkingMs(LOOSE, situation(), () => 0)).not.toBe(
      thinkingMs(LOOSE, situation(), () => 1),
    )
  })

  it('lets the talkative characters take longer', () => {
    expect(thinkingMs(LOOSE, situation(), () => 0.5)).toBeGreaterThan(
      thinkingMs(TIGHT, situation(), () => 0.5),
    )
  })

  it('snaps a fold with nothing in it and takes its time over a big call', () => {
    // The tell a person gives is not how long they take but how that changes with the
    // decision. Every bot used to take 0.9 to 3 seconds whatever it was deciding.
    const snap = thinkingMs(
      TIGHT,
      situation({ action: 'fold', street: 'preflop', betToCall: 100, pot: 1_000 }),
      () => 0.5,
    )
    const agonise = thinkingMs(
      TIGHT,
      situation({ action: 'call', street: 'river', betToCall: 1_000, pot: 1_000 }),
      () => 0.5,
    )
    expect(agonise).toBeGreaterThan(snap * 3)
  })

  it('thinks longer the bigger the price, for the same decision', () => {
    const small = thinkingMs(TIGHT, situation({ betToCall: 100 }), () => 0.9)
    const large = thinkingMs(TIGHT, situation({ betToCall: 900 }), () => 0.9)
    expect(large).toBeGreaterThan(small)
  })

  it('checks quicker than it raises', () => {
    const check = thinkingMs(TIGHT, situation({ action: 'check', betToCall: 0 }), () => 0.5)
    const raise = thinkingMs(TIGHT, situation({ action: 'raiseTo', betToCall: 0 }), () => 0.5)
    expect(raise).toBeGreaterThan(check)
  })

  it('sometimes tanks on a big decision, and never past the ceiling', () => {
    // A draw under the tank chance tanks; a draw over it does not.
    const tanked = thinkingMs(LOOSE, situation({ action: 'allIn', street: 'river' }), () => 0.05)
    const quick = thinkingMs(LOOSE, situation({ action: 'allIn', street: 'river' }), () => 0.2)
    expect(tanked).toBeGreaterThan(quick)
    for (const draw of [0, 0.05, 0.5, 0.99]) {
      const ms = thinkingMs(
        LOOSE,
        situation({ action: 'allIn', street: 'river', betToCall: 5_000, pot: 1_000 }),
        () => draw,
      )
      expect(ms).toBeLessThanOrEqual(11_000)
    }
  })

  it('adds the look at the cards to the first decision of a hand', () => {
    expect(thinkingMs(TIGHT, situation({ firstLook: true }), () => 0.5)).toBeGreaterThan(
      thinkingMs(TIGHT, situation({ firstLook: false }), () => 0.5),
    )
  })
})

describe('looking at the cards', () => {
  it('lets most bots look soon after the deal and leaves the rest for later', () => {
    expect(peekAfterDealMs(() => 0.3)).not.toBeNull()
    expect(peekAfterDealMs(() => 0.9)).toBeNull()
    // Spread across a couple of seconds rather than on the deal's own frame.
    const early = peekAfterDealMs(
      (() => {
        const draws = [0.1, 0]
        return () => draws.shift() ?? 0
      })(),
    )
    const late = peekAfterDealMs(
      (() => {
        const draws = [0.1, 0.99]
        return () => draws.shift() ?? 0
      })(),
    )
    expect(early).not.toBeNull()
    expect(late).toBeGreaterThan(early ?? 0)
  })

  it('always looks inside the first think of a hand, before the action lands', () => {
    const at = peekDuringThinkMs(situation({ firstLook: true }), 2_000, () => 0.99)
    expect(at).not.toBeNull()
    expect(at).toBeLessThan(2_000 * 0.5)
  })

  it('looks again more often facing a bet worth paying for than when checked to', () => {
    // 0.2 is under the chance facing a big bet and over the chance when checked to.
    const facing = peekDuringThinkMs(situation({ betToCall: 800, pot: 1_000 }), 4_000, () => 0.2)
    const checked = peekDuringThinkMs(situation({ betToCall: 0, pot: 1_000 }), 4_000, () => 0.2)
    expect(facing).not.toBeNull()
    expect(checked).toBeNull()
  })

  it('does not start a second look in a think too short to finish it', () => {
    expect(peekDuringThinkMs(situation({ betToCall: 800 }), 1_500, () => 0)).toBeNull()
  })
})
