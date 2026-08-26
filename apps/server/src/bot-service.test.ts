import type { BotPersonality } from '@river/engine'
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
  profileFor,
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

describe('thinking time', () => {
  it('never answers instantly', () => {
    for (const personality of [TIGHT, LOOSE]) {
      expect(thinkingMs(personality, () => 0)).toBeGreaterThan(500)
    }
  })

  it('varies, because a constant delay is its own tell', () => {
    expect(thinkingMs(LOOSE, () => 0)).not.toBe(thinkingMs(LOOSE, () => 1))
  })

  it('lets the talkative characters take longer', () => {
    expect(thinkingMs(LOOSE, () => 0.5)).toBeGreaterThan(thinkingMs(TIGHT, () => 0.5))
  })
})
