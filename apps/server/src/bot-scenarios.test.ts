import {
  type BotPersonality,
  type BotPolicy,
  type BotSkill,
  deterministicRulePolicy,
  type HandAction,
  legacyRulePolicy,
  mulberry32,
  parseCard,
  SEATS_PER_SHAPE,
  type TurnAction,
  v5RulePolicy,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'
import { actionFor, botPlayerId } from './bot-service.js'
import type { RoomSeatView, RoomView } from './protocol.js'

interface PokerScenario {
  readonly id: string
  readonly street: RoomView['street']
  readonly hole: readonly [string, string]
  readonly board: readonly string[]
  readonly pot: number
  readonly currentBet: number
  readonly minRaiseTo: number
  readonly dealerSeat: number
}

const scenarios: readonly PokerScenario[] = [
  {
    id: 'premium_aces_preflop',
    street: 'preflop',
    hole: ['As', 'Ah'],
    board: [],
    pot: 750,
    currentBet: 500,
    minRaiseTo: 1_000,
    dealerSeat: 7,
  },
  {
    id: 'seven_deuce_facing_raise',
    street: 'preflop',
    hole: ['2c', '7d'],
    board: [],
    pot: 4_500,
    currentBet: 3_000,
    minRaiseTo: 6_000,
    dealerSeat: 7,
  },
  {
    id: 'cheap_turn_flush_draw',
    street: 'turn',
    hole: ['As', '9s'],
    board: ['2s', '7s', 'Kd', '4c'],
    pot: 3_300,
    currentBet: 300,
    minRaiseTo: 600,
    dealerSeat: 7,
  },
  {
    id: 'expensive_turn_flush_draw',
    street: 'turn',
    hole: ['As', '9s'],
    board: ['2s', '7s', 'Kd', '4c'],
    pot: 9_000,
    currentBet: 6_000,
    minRaiseTo: 12_000,
    dealerSeat: 7,
  },
  {
    id: 'paired_board_turn_flush_draw',
    street: 'turn',
    hole: ['As', '9s'],
    board: ['2s', '2d', '7s', 'Kc'],
    pot: 3_300,
    currentBet: 300,
    minRaiseTo: 600,
    dealerSeat: 7,
  },
  {
    id: 'nut_flush_river',
    street: 'river',
    hole: ['As', '9s'],
    board: ['2s', '7s', 'Ks', '4c', 'Qh'],
    pot: 3_000,
    currentBet: 0,
    minRaiseTo: 500,
    dealerSeat: 7,
  },
  {
    id: 'king_high_flush_river',
    street: 'river',
    hole: ['Ks', '9s'],
    board: ['2s', '7s', 'Qs', '4c', '3h'],
    pot: 4_500,
    currentBet: 1_500,
    minRaiseTo: 3_000,
    dealerSeat: 7,
  },
  {
    id: 'missed_draw_river',
    street: 'river',
    hole: ['As', '9s'],
    board: ['2s', '7s', 'Kd', '4c', 'Qh'],
    pot: 6_000,
    currentBet: 3_000,
    minRaiseTo: 6_000,
    dealerSeat: 7,
  },
  {
    id: 'marginal_open_early',
    street: 'preflop',
    hole: ['Jc', '9c'],
    board: [],
    pot: 750,
    currentBet: 500,
    minRaiseTo: 1_000,
    dealerSeat: 7,
  },
  {
    id: 'marginal_open_button',
    street: 'preflop',
    hole: ['Jc', '9c'],
    board: [],
    pot: 750,
    currentBet: 500,
    minRaiseTo: 1_000,
    dealerSeat: 2,
  },
]

const actorId = botPlayerId('scenario')
const skills: readonly BotSkill[] = ['rookie', 'novice', 'og']

function personality(skill: BotSkill): BotPersonality {
  return {
    id: 'scenario',
    name: 'Alex',
    skill,
    aggression: 0.5,
    tightness: 0.5,
    bluffRate: 0.1,
    tiltResistance: 0.5,
    chatter: 'occasional',
  }
}

function scenarioView(scenario: PokerScenario): RoomView {
  const actorSeat = 2
  const seats: RoomSeatView[] = Array.from({ length: SEATS_PER_SHAPE.full }, (_, seat) => ({
    seat,
    playerId: seat === actorSeat ? actorId : `player-${seat}`,
    name: seat === actorSeat ? 'Alex' : `Player ${seat}`,
    stack: 20_000,
    betHand: 0,
    betStreet: seat === 0 ? scenario.currentBet : 0,
    folded: false,
    allIn: false,
    hole: seat === actorSeat ? scenario.hole.map(parseCard) : null,
    hasHole: true,
    sittingOut: false,
    busted: false,
    disconnected: false,
    dealer: seat === scenario.dealerSeat,
  }))
  const callAmount = scenario.currentBet
  return {
    venueId: 'rooftop',
    handNumber: 1,
    phase: 'hand',
    street: scenario.street,
    board: scenario.board.map(parseCard),
    pot: scenario.pot,
    currentBet: scenario.currentBet,
    countdownMs: 0,
    seats,
    currentActor: { playerId: actorId, seat: actorSeat },
    legal: {
      fold: { enabled: callAmount > 0, amount: 0 },
      check: { enabled: callAmount === 0, amount: 0 },
      call: { enabled: callAmount > 0, amount: callAmount },
      raiseTo: { enabled: scenario.minRaiseTo <= 20_000, min: scenario.minRaiseTo },
      allIn: { enabled: true, amount: 20_000 },
    },
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId: actorId,
    challenges: [],
    hostPlayerId: actorId,
    inviteCode: 'RIVER2',
  }
}

function decide(
  scenario: PokerScenario,
  skill: BotSkill,
  seed: number,
  publicActions?: readonly HandAction[],
  policy?: BotPolicy,
): TurnAction {
  const action = actionFor(scenarioView(scenario), actorId, personality(skill), mulberry32(seed), {
    ...(publicActions === undefined ? {} : { publicActions }),
    ...(policy === undefined ? {} : { policy }),
  })
  if (action === null) throw new Error(`scenario ${scenario.id} returned no action`)
  return action
}

describe('bot poker scenario corpus', () => {
  it('provides ten distinct, valid card situations', () => {
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(10)
    for (const scenario of scenarios) {
      const cards = [...scenario.hole, ...scenario.board]
      expect(new Set(cards).size).toBe(cards.length)
      expect(scenario.currentBet).toBeLessThanOrEqual(scenario.pot)
    }
  })

  it.each(scenarios)('$id produces enabled legal actions for every skill and seed', (scenario) => {
    const view = scenarioView(scenario)
    const legal = view.legal
    if (legal === null) throw new Error('scenario has no legal actions')
    for (const skill of skills) {
      for (let seed = 0; seed < 32; seed += 1) {
        const action = decide(scenario, skill, seed)
        if (action.kind === 'raiseTo') {
          expect(legal.raiseTo.enabled).toBe(true)
          expect(action.to).toBeGreaterThanOrEqual(legal.raiseTo.min)
          expect(action.to).toBeLessThanOrEqual(20_000)
        } else {
          expect(legal[action.kind].enabled).toBe(true)
        }
      }
    }
  })

  it('never folds pocket aces facing the big blind in the OG sample', () => {
    const scenario = scenarios.find((entry) => entry.id === 'premium_aces_preflop')
    if (scenario === undefined) throw new Error('missing pocket aces scenario')
    for (let seed = 0; seed < 64; seed += 1) {
      expect(decide(scenario, 'og', seed).kind).not.toBe('fold')
    }
  })

  it('puts chips in with the river nut flush in most OG seeds', () => {
    const scenario = scenarios.find((entry) => entry.id === 'nut_flush_river')
    if (scenario === undefined) throw new Error('missing nut flush scenario')
    const bets = Array.from({ length: 64 }, (_, seed) => decide(scenario, 'og', seed)).filter(
      (action) => action.kind === 'raiseTo' || action.kind === 'allIn',
    ).length
    expect(bets).toBeGreaterThanOrEqual(32)
  })

  it('prices an OG flush draw from the turn card and the immediate call price', () => {
    const cheap = scenarios.find((entry) => entry.id === 'cheap_turn_flush_draw')
    const expensive = scenarios.find((entry) => entry.id === 'expensive_turn_flush_draw')
    if (cheap === undefined || expensive === undefined)
      throw new Error('missing turn draw scenario')
    for (let seed = 0; seed < 64; seed += 1) {
      expect(decide(cheap, 'og', seed, undefined, v5GuardPolicy).kind).toBe('call')
      expect(decide(cheap, 'og', seed).kind).not.toBe('fold')
      expect(decide(expensive, 'og', seed).kind).toBe('fold')
    }
  })

  it('discounts the direct flush-draw rule when the board is paired', () => {
    const clean = scenarios.find((entry) => entry.id === 'cheap_turn_flush_draw')
    const paired = scenarios.find((entry) => entry.id === 'paired_board_turn_flush_draw')
    if (clean === undefined || paired === undefined) throw new Error('missing paired draw scenario')
    const calls = (scenario: PokerScenario) =>
      Array.from({ length: 64 }, (_, seed) =>
        decide(scenario, 'og', seed, undefined, v5GuardPolicy),
      ).filter((action) => action.kind === 'call').length
    expect(calls(clean)).toBe(64)
    expect(calls(paired)).toBeLessThan(calls(clean))
    const liveCalls = Array.from({ length: 64 }, (_, seed) => decide(clean, 'og', seed)).filter(
      (action) => action.kind === 'call' || action.kind === 'raiseTo',
    ).length
    expect(liveCalls).toBe(64)
  })

  it('continues with the same marginal suited hand more often on the button', () => {
    const early = scenarios.find((entry) => entry.id === 'marginal_open_early')
    const button = scenarios.find((entry) => entry.id === 'marginal_open_button')
    if (early === undefined || button === undefined) throw new Error('missing position scenario')
    const continues = (scenario: PokerScenario) =>
      Array.from({ length: 200 }, (_, seed) => decide(scenario, 'og', seed)).filter(
        (action) => action.kind !== 'fold',
      ).length
    expect(continues(button) - continues(early)).toBeGreaterThanOrEqual(30)
  })

  it('uses sustained large public bets as bounded pressure rather than a hidden-card fact', () => {
    const marginal: PokerScenario = {
      id: 'two_pair_facing_sustained_pressure',
      street: 'river',
      hole: ['Ah', 'Qh'],
      board: ['As', 'Qc', '7d', '3s', '2h'],
      pot: 5_400,
      currentBet: 1_800,
      minRaiseTo: 3_600,
      dealerSeat: 7,
    }
    const pressure: readonly HandAction[] = [
      {
        seat: 0,
        street: 'turn',
        action: { kind: 'raiseTo', to: 1_500 },
        amountCommitted: 1_500,
        potBefore: 2_000,
        streetBetAfter: 1_500,
      },
      {
        seat: 0,
        street: 'river',
        action: { kind: 'raiseTo', to: 1_800 },
        amountCommitted: 1_800,
        potBefore: 2_400,
        streetBetAfter: 1_800,
      },
    ]
    const folds = (actions?: readonly HandAction[]) =>
      Array.from({ length: 200 }, (_, seed) =>
        decide(marginal, 'og', seed, actions, v5GuardPolicy),
      ).filter((action) => action.kind === 'fold').length
    expect(folds(pressure)).toBeGreaterThan(folds())

    const strong = { ...marginal, hole: ['Ac', 'Ad'] as const }
    for (let seed = 0; seed < 64; seed += 1) {
      expect(decide(strong, 'og', seed, pressure).kind).not.toBe('fold')
    }
  })

  it('does not price a made straight with a flush draw as only nine outs', () => {
    const straightDraw: PokerScenario = {
      id: 'made_straight_and_flush_draw',
      street: 'flop',
      hole: ['9s', '8s'],
      board: ['7s', '6s', '5h'],
      pot: 1_000,
      currentBet: 666,
      minRaiseTo: 1_332,
      dealerSeat: 7,
    }
    expect(decide(straightDraw, 'og', 1, undefined, v5RulePolicy).kind).toBe('fold')
    expect(decide(straightDraw, 'og', 1, undefined, v5GuardPolicy).kind).toBe('call')
    expect(decide(straightDraw, 'og', 1).kind).not.toBe('fold')
    expect(decide(straightDraw, 'rookie', 1, undefined, pokerGuardPolicy)).toEqual(
      decide(straightDraw, 'rookie', 1),
    )
  })

  it('does not fold two pair with a flush draw solely on the nine-out shortcut', () => {
    const twoPairDraw: PokerScenario = {
      id: 'turn_two_pair_and_flush_draw',
      street: 'turn',
      hole: ['As', '9s'],
      board: ['Ah', '9h', '2s', '7s'],
      pot: 1_000,
      currentBet: 666,
      minRaiseTo: 1_332,
      dealerSeat: 7,
    }
    expect(decide(twoPairDraw, 'og', 1, undefined, v5RulePolicy).kind).toBe('fold')
    expect(decide(twoPairDraw, 'og', 1, undefined, v5GuardPolicy).kind).toBe('call')
    expect(decide(twoPairDraw, 'og', 1).kind).not.toBe('fold')
  })

  it('treats premium broadways as playable and small pairs as speculative preflop', () => {
    const base = scenarios.find((entry) => entry.id === 'premium_aces_preflop')
    if (base === undefined) throw new Error('missing preflop base')
    const actions = (hole: readonly [string, string], policy: BotPolicy) =>
      Array.from({ length: 200 }, (_, seed) =>
        decide({ ...base, hole }, 'og', seed, undefined, policy),
      )
    const oldAceKing = actions(['As', 'Ks'], legacyRulePolicy)
    const newAceKing = actions(['As', 'Ks'], pokerStrongCandidatePolicy)
    expect(oldAceKing.filter((action) => action.kind === 'fold').length).toBeGreaterThan(150)
    expect(newAceKing.filter((action) => action.kind === 'raiseTo').length).toBeGreaterThan(150)
    const oldDeuces = actions(['2s', '2h'], legacyRulePolicy)
    const newDeuces = actions(['2s', '2h'], pokerStrongCandidatePolicy)
    expect(oldDeuces.filter((action) => action.kind === 'raiseTo').length).toBeGreaterThan(80)
    expect(newDeuces.filter((action) => action.kind === 'fold').length).toBeGreaterThan(150)
    expect(
      actions(['7s', '2h'], pokerStrongCandidatePolicy).filter((action) => action.kind === 'fold')
        .length,
    ).toBeGreaterThan(170)
    const liveAceKing = actions(['As', 'Ks'], pokerGuardPolicy)
    const liveDeuces = actions(['2s', '2h'], pokerGuardPolicy)
    expect(liveAceKing.filter((action) => action.kind === 'raiseTo').length).toBeGreaterThan(150)
    expect(liveDeuces.filter((action) => action.kind === 'fold').length).toBeGreaterThan(150)
  })

  it('keeps premium preflop aggression bounded with a deep stack', () => {
    const unopened: PokerScenario = {
      id: 'premium_deep_stack_unopened',
      street: 'preflop',
      hole: ['As', 'Ks'],
      board: [],
      pot: 750,
      currentBet: 0,
      minRaiseTo: 500,
      dealerSeat: 7,
    }
    const actions = Array.from({ length: 200 }, (_, seed) =>
      decide(unopened, 'og', seed, undefined, pokerStrongCandidatePolicy),
    )
    expect(actions.filter((action) => action.kind === 'allIn')).toHaveLength(0)
    expect(actions.filter((action) => action.kind === 'raiseTo').length).toBeGreaterThan(100)
  })

  it('does not turn a bluff attempt with trash into a forced preflop all-in', () => {
    const facingShove: PokerScenario = {
      id: 'trash_facing_shove',
      street: 'preflop',
      hole: ['7s', '2h'],
      board: [],
      pot: 30_000,
      currentBet: 20_000,
      minRaiseTo: 40_000,
      dealerSeat: 7,
    }
    const actions = Array.from({ length: 200 }, (_, seed) =>
      decide(facingShove, 'og', seed, undefined, pokerStrongCandidatePolicy),
    )
    expect(actions.filter((action) => action.kind === 'allIn')).toHaveLength(0)
    expect(actions.filter((action) => action.kind === 'fold').length).toBeGreaterThan(180)
  })

  it('does not change Rookie or Novice decisions in the OG preflop candidate', () => {
    for (const scenario of scenarios) {
      for (const skill of ['rookie', 'novice'] as const) {
        for (let seed = 0; seed < 32; seed += 1) {
          expect(decide(scenario, skill, seed, undefined, pokerStrongCandidatePolicy)).toEqual(
            decide(scenario, skill, seed, undefined, pokerGuardPolicy),
          )
        }
      }
    }
  })
})
