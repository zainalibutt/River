import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  type Card,
  type HandAction,
  mulberry32,
  parseCard,
  personalityPool,
  type Street,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import type { PublicDecision } from './bot-public-replay.js'
import {
  readsModel,
  riverSolverPolicy,
  trackRanges,
  translate,
  withAir,
} from './bot-river-policy.js'
import { prepare, type RiverNode, type RiverSpot, riverTree } from './bot-river-solver.js'
import { profileFor } from './bot-service.js'
import { runSessions } from './bot-session-benchmark.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}
const board = cards('Qs 9h 6d 3c 2s')

/** A two-seat view with the betting fields filled in as the table fills them. */
function view(fields: {
  readonly street: Street
  readonly pot: number
  readonly currentBet: number
  readonly betStreet: number
  readonly stack: number
  readonly hole?: readonly Card[]
}): BotObservationV1 {
  const { street, pot, currentBet, betStreet, stack } = fields
  const amountToCall = Math.max(0, currentBet - betStreet)
  const maxTo = stack + betStreet
  return {
    version: 1,
    roomId: 'river-policy-test',
    handNumber: 1,
    actor: { playerId: 'a', seat: 0, hole: [...(fields.hole ?? [])], stack, betHand: 0, betStreet },
    street,
    board: street === 'preflop' ? [] : board,
    dealerSeat: 1,
    pot,
    currentBet,
    amountToCall,
    legal: {
      fold: true,
      check: amountToCall === 0,
      call: { enabled: amountToCall > 0, amount: Math.min(amountToCall, stack) },
      raiseTo: { enabled: maxTo > 2 * currentBet, min: Math.max(100, 2 * currentBet), max: maxTo },
      allIn: { enabled: stack > 0, amount: maxTo },
    },
    seats: [
      { seat: 0, playerId: 'a', stack, betHand: 0, betStreet, folded: false, allIn: false },
      { seat: 1, playerId: 'b', stack, betHand: 0, betStreet: 0, folded: false, allIn: false },
    ].map((seat) => ({ ...seat, away: false })),
    opponents: [],
    actions: [],
    tilt: { factor: 0 },
  }
}

function move(observation: BotObservationV1, action: HandAction['action']): PublicDecision {
  return { observation, taken: { seat: 0, street: observation.street, action } }
}

describe('mapping table moves onto the solved tree', () => {
  const spot: RiverSpot = {
    board,
    pot: 1000,
    stack: 10_000,
    ranges: [[], []],
    betSizes: [0.5, 1],
    allIn: true,
    maxRaises: 1,
  }
  const root = riverTree(spot) as Extract<RiverNode, { kind: 'action' }>

  it('takes a bet to the nearest offered share of the pot', () => {
    expect(root.actions).toEqual(['k', 'b500', 'b1000', 'a'])
    const opening = view({ street: 'river', pot: 1000, currentBet: 0, betStreet: 0, stack: 10_000 })
    expect(translate(root, move(opening, { kind: 'check' }), spot)).toBe('k')
    expect(translate(root, move(opening, { kind: 'raiseTo', to: 600 }), spot)).toBe('b500')
    expect(translate(root, move(opening, { kind: 'raiseTo', to: 900 }), spot)).toBe('b1000')
    expect(translate(root, move(opening, { kind: 'allIn' }), spot)).toBe('a')
  })

  it('takes a raise the same way, and an all-in that only matches the bet as a call', () => {
    const facing = root.children[1] as Extract<RiverNode, { kind: 'action' }>
    expect(facing.actions).toEqual(['f', 'c', 'b1500', 'b2500', 'a'])
    const raised = view({
      street: 'river',
      pot: 1500,
      currentBet: 500,
      betStreet: 0,
      stack: 10_000,
    })
    expect(translate(facing, move(raised, { kind: 'raiseTo', to: 2400 }), spot)).toBe('b2500')
    expect(translate(facing, move(raised, { kind: 'call' }), spot)).toBe('c')
    const short = view({ street: 'river', pot: 1500, currentBet: 500, betStreet: 0, stack: 400 })
    expect(translate(facing, move(short, { kind: 'allIn' }), spot)).toBe('c')
  })
})

describe('ranges from the blueprint', () => {
  it('keeps what the blueprint would have done: a raise from a pairs-only raiser is pairs', () => {
    const pairsRaise: BotPolicy = {
      id: 'pairs-raise',
      version: 1,
      decide(context) {
        const [first, second] = context.observation.actor.hole
        const pair = first !== undefined && first.rank === second?.rank
        const decision: BotDecision = pair
          ? { kind: 'raiseTo', to: context.observation.legal.raiseTo.min }
          : { kind: 'call' }
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: 1,
          decision,
          fallbackReason: null,
        }
      },
    }
    const opening = view({
      street: 'preflop',
      pot: 150,
      currentBet: 100,
      betStreet: 50,
      stack: 9950,
    })
    const [raiser, other] = trackRanges(
      board,
      [move(opening, { kind: 'raiseTo', to: 300 })],
      ['a', 'b'],
      pairsRaise,
      person(10),
      'pairs',
    )
    const total = raiser.reduce((sum, holding) => sum + holding.weight, 0)
    const pairs = raiser
      .filter((holding) => holding.hole[0].rank === holding.hole[1].rank)
      .reduce((sum, holding) => sum + holding.weight, 0)
    expect(raiser).toHaveLength(1081)
    expect(pairs / total).toBeGreaterThan(0.9)
    expect(other.every((holding) => holding.weight === 1)).toBe(true)
  })

  it('uses the shares another policy reports for the moves it chose', () => {
    const opening = view({
      street: 'preflop',
      pot: 150,
      currentBet: 100,
      betStreet: 50,
      stack: 9950,
    })
    // The move was chosen by a policy that raises suited hands, not by the blueprint.
    const [raiser] = trackRanges(
      board,
      [move(opening, { kind: 'raiseTo', to: 300 })],
      ['a', 'b'],
      legacyGuardPolicy,
      person(10),
      'pairs',
      undefined,
      undefined,
      (_decision, taken) =>
        taken === 'aggressive' ? (hole) => (hole[0].suit === hole[1].suit ? 1 : 0) : null,
    )
    const total = raiser.reduce((sum, holding) => sum + holding.weight, 0)
    const suited = raiser
      .filter((holding) => holding.hole[0].suit === holding.hole[1].suit)
      .reduce((sum, holding) => sum + holding.weight, 0)
    expect(suited / total).toBeGreaterThan(0.95)
  })
})

describe('air in the opponent range', () => {
  it('spreads a share of the weight evenly and keeps the total', () => {
    const range = [
      { hole: cards('Ah Kh') as [Card, Card], weight: 3 },
      { hole: cards('7c 2d') as [Card, Card], weight: 0 },
      { hole: cards('Jd Td') as [Card, Card], weight: 1 },
    ]
    const aired = withAir(range, 0.25)
    expect(aired.map((holding) => holding.weight)).toEqual([2.25 + 1 / 3, 1 / 3, 0.75 + 1 / 3])
    expect(aired.reduce((sum, holding) => sum + holding.weight, 0)).toBeCloseTo(4, 12)
    expect(withAir(range, 0)).toEqual(range)
  })
})

describe('the river-solving OG', () => {
  it('plays exactly the blueprint before the river', () => {
    const { policy } = riverSolverPolicy(legacyGuardPolicy, 'river-solver-test', 1)
    const observation = view({
      street: 'flop',
      pot: 400,
      currentBet: 0,
      betStreet: 0,
      stack: 9800,
      hole: cards('Ah Kh'),
    })
    const context = (seed: number) => ({
      observation,
      profile: profileFor(person(10)),
      personality: person(10),
      tilt: observation.tilt,
      rng: mulberry32(seed),
    })
    for (let seed = 0; seed < 20; seed += 1) {
      expect(policy.decide(context(seed)).decision).toEqual(
        legacyGuardPolicy.decide(context(seed)).decision,
      )
    }
  })

  it('answers two-player rivers from the solve with legal moves', () => {
    // Few iterations: this checks that the solver takes the river decisions and
    // plays them legally; how well it converges is tested on known spots.
    const solver = riverSolverPolicy(legacyGuardPolicy, 'river-solver-test', 1, { iterations: 20 })
    const river: { observation: BotObservationV1; decision: BotDecision }[] = []
    const focal: BotPolicy = {
      id: solver.policy.id,
      version: solver.policy.version,
      decide(context) {
        const envelope = solver.policy.decide(context)
        if (context.observation.street === 'river') {
          river.push({ observation: context.observation, decision: envelope.decision })
        }
        return envelope
      },
    }
    runSessions({
      seed: 'river-policy-test',
      sessions: 2,
      handsPerSession: 8,
      table: {
        name: 'heads-up',
        style: 'plain',
        entrants: [{ personality: person(10) }, { personality: person(0) }],
      },
      focalPolicy: focal,
    })
    expect(river.length).toBeGreaterThan(0)
    expect(solver.stats.solved).toBe(river.length)
    expect(solver.stats.fallbacks).toEqual({})
    for (const { observation, decision } of river) {
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
  }, 120_000)
})

describe('the reads as a river strategy', () => {
  // Ten holdings of distinct strength on this board, weakest to strongest by rank of the pair.
  const holdings = [
    '3c 3d',
    '4c 4d',
    '5c 5d',
    '7c 7d',
    '8c 8d',
    'Tc Td',
    'Jc Jd',
    'Kc Kd',
    'Ac Ad',
    'Qc Qd',
  ]
  const spot: RiverSpot = {
    board: cards('Qs 9h 6d 2c 2s'),
    pot: 1000,
    stack: 10_000,
    ranges: [[], holdings.map((text) => ({ hole: cards(text) as [Card, Card], weight: 1 }))],
    betSizes: [0.5, 1],
    allIn: true,
    maxRaises: 1,
  }
  const hands = prepare(spot.ranges[1], spot.board)
  const tree = riverTree(spot) as Extract<RiverNode, { kind: 'action' }>
  const reads = {
    bet: 0.5,
    fold: 0.3,
    raise: 0.1,
    foldSmall: 0.3,
    foldMedium: 0.3,
    foldLarge: 0.3,
    air: 0.2,
    size: 1,
    trust: 0.5,
  }
  const shareIn = (
    model: ReturnType<typeof readsModel>,
    node: Extract<RiverNode, { kind: 'action' }>,
    label: string,
    text: string,
  ) => {
    const index = hands.combos.findIndex(
      (combo) => combo.hole.map((card) => `${card.rank}${card.suit}`).join(' ') === text,
    )
    return model.strategy(node, hands)[index * node.actions.length + node.actions.indexOf(label)]
  }
  const model = readsModel(reads, spot, 1)
  const share = (node: Extract<RiverNode, { kind: 'action' }>, label: string, text: string) =>
    shareIn(model, node, label, text)

  it('bets its strongest hands and, in the shown share of air, its weakest', () => {
    const checkedTo = tree.children[0] as Extract<RiverNode, { kind: 'action' }>
    expect(checkedTo.actions).toEqual(['k', 'b500', 'b1000', 'a'])
    for (const text of ['Qc Qd', 'Ac Ad', 'Kc Kd', 'Jc Jd', '3c 3d'])
      expect(share(checkedTo, 'b1000', text)).toBe(1)
    for (const text of ['4c 4d', '5c 5d', '7c 7d', '8c 8d', 'Tc Td'])
      expect(share(checkedTo, 'k', text)).toBe(1)
  })

  it('folds its weakest hands to a bet and calls with the middle', () => {
    const facing = tree.children[2] as Extract<RiverNode, { kind: 'action' }>
    expect(facing.actions[0]).toBe('f')
    expect(share(facing, 'f', '3c 3d')).toBeCloseTo(0.8, 12)
    expect(share(facing, 'f', '4c 4d')).toBe(1)
    expect(share(facing, 'f', '5c 5d')).toBe(1)
    expect(share(facing, 'f', '7c 7d')).toBeCloseTo(0.2, 12)
    expect(share(facing, 'c', 'Tc Td')).toBe(1)
    expect(share(facing, 'f', 'Qc Qd')).toBe(0)
  })

  it('folds by the size of the bet it faces when the reads say so', () => {
    // Folds a tenth of hands to a half-pot bet and nine tenths to an all-in.
    const sized = readsModel({ ...reads, foldSmall: 0.1, foldLarge: 0.9 }, spot, 1)
    const small = tree.children[1] as Extract<RiverNode, { kind: 'action' }>
    const shove = tree.children[3] as Extract<RiverNode, { kind: 'action' }>
    expect([tree.actions[1], tree.actions[3]]).toEqual(['b500', 'a'])
    const folded = (node: Extract<RiverNode, { kind: 'action' }>) =>
      holdings.reduce((sum, text) => sum + (shareIn(sized, node, 'f', text) ?? 0), 0) /
      holdings.length
    expect(folded(small)).toBeCloseTo(0.1, 12)
    expect(folded(shove)).toBeCloseTo(0.9, 12)
  })
})
