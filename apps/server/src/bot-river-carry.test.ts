import {
  type BotObservationV1,
  type Card,
  cardKey,
  mulberry32,
  parseCard,
  personalityPool,
} from '@river/engine'
import { describe, expect, it, vi } from 'vitest'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { exactTurnAction, riverCarryFromRecord } from './bot-river-carry.js'
import { riverSolverPolicy } from './bot-river-policy.js'
import { prepare, type RangeCombo, type RiverSpot, riverTree } from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { profileFor } from './bot-service.js'
import { TURN_STREET, turnSolverPolicy } from './bot-turn-policy.js'
import { createRiverPromiseRecord, perRiverShowdown } from './bot-turn-river-leaves.js'
import { type RiverValueNetwork, riverNetworkFromEnvironment } from './bot-value-network.js'

vi.mock('./bot-public-replay.js', () => ({ publicDecisions: vi.fn() }))
const cards = (s: string) => s.split(' ').map(parseCard)
const held = (s: string, weight = 1): RangeCombo => ({ hole: cards(s) as [Card, Card], weight })
const index = (h: RangeCombo) => comboIndex52(cardKey(h.hole[0]), cardKey(h.hole[1]))
const network: RiverValueNetwork = {
  buckets: 1,
  layers: [
    {
      rows: 2,
      columns: 4,
      slope: null,
      weight: new Float32Array(8),
      bias: Float32Array.of(0.5, 0.5),
    },
  ],
}
const person = personalityPool()[10]
if (person === undefined) throw new Error('missing test personality')

function view(street: 'turn' | 'river', playerId = 'a', pot = 100, paid = 0): BotObservationV1 {
  return {
    version: 1,
    roomId: 'carry-test',
    handNumber: 1,
    street,
    board: cards(street === 'turn' ? 'Ah Kd 7s 4c' : 'Ah Kd 7s 4c 2d'),
    dealerSeat: 1,
    actor: {
      playerId,
      seat: playerId === 'a' ? 0 : 1,
      hole: cards('Ac Qc'),
      stack: 300 - paid,
      betHand: paid,
      betStreet: street === 'turn' ? paid : 0,
    },
    pot,
    currentBet: 0,
    amountToCall: 0,
    legal: {
      fold: true,
      check: true,
      call: { enabled: false, amount: 0 },
      raiseTo: { enabled: true, min: 1, max: 300 - paid },
      allIn: { enabled: true, amount: 300 - paid },
    },
    seats: ['a', 'b'].map((id, seat) => ({
      seat,
      playerId: id,
      stack: 300 - paid,
      betHand: paid,
      betStreet: street === 'turn' ? paid : 0,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    actions: [],
    tilt: { factor: 0 },
  }
}
const move = (
  observation: BotObservationV1,
  action: PublicDecision['taken']['action'],
): PublicDecision => ({
  observation,
  taken: { seat: observation.actor.seat, street: observation.street, action },
})
const context = (observation: BotObservationV1) => ({
  observation,
  personality: person,
  profile: profileFor(person),
  tilt: observation.tilt,
  rng: mulberry32(1),
})

function policies(carry = true, safeTurn = false) {
  let turn: ReturnType<typeof turnSolverPolicy> | undefined
  const river = riverSolverPolicy(
    legacyGuardPolicy,
    'river-test',
    1,
    {
      safe: true,
      iterations: 2,
      betSizes: [],
      maxRaises: 0,
      ...(carry ? { carry: 'per-river' as const } : {}),
    },
    () => null,
    () => null,
    (observation, personality, history, players) =>
      turn?.carried(observation, personality, history, players) ?? null,
  )
  turn = turnSolverPolicy(
    river.policy,
    network,
    'turn-test',
    1,
    {
      iterations: 2,
      betSizes: [0.5],
      maxRaises: 0,
      ...(carry ? { carry: 'per-river' as const, riverNetwork: network } : {}),
    },
    { ...TURN_STREET, safe: safeTurn },
  )
  return { turn, river }
}

describe('opt-in per-river policy carry', () => {
  it.each([false, true])(
    'uses a cached exact turn leaf (turn gadget=%s) and counts the carried river solve',
    (safeTurn) => {
      const opening = view('turn')
      const riverView = view('river')
      const history = [move(opening, { kind: 'check' }), move(view('turn', 'b'), { kind: 'check' })]
      vi.mocked(publicDecisions).mockImplementation((observation) =>
        observation.street === 'river' ? history : [],
      )
      const { turn, river } = policies(true, safeTurn)
      turn.policy.decide(context(opening))
      expect(turn.stats.solves).toBe(1)
      turn.policy.decide(context(riverView))
      expect(turn.stats.solves).toBe(1) // a carry lookup must not create another turn solve
      expect(river.stats.carryUsed).toBe(1)
      expect(river.stats.carryFallbacks).toBe(0)
      expect(river.stats.solved).toBe(1)
      turn.policy.decide(context(riverView))
      expect(river.stats.carryUsed).toBe(1) // counters measure solves, not cached decisions
    },
  )

  it('carries an exact called bet into the increased river pot', () => {
    const opening = view('turn')
    const history = [
      move(opening, { kind: 'raiseTo', to: 50 }),
      move(view('turn', 'b'), { kind: 'call' }),
    ]
    vi.mocked(publicDecisions).mockImplementation((observation) =>
      observation.street === 'river' ? history : [],
    )
    const { turn, river } = policies()
    turn.policy.decide(context(opening))
    turn.policy.decide(context(view('river', 'a', 200, 50)))
    expect(river.stats.carryUsed).toBe(1)
    expect(river.stats.carryFallbacks).toBe(0)
    expect(river.stats.solved).toBe(1)
  })

  it('counts an off-tree size and a missing cached record as fallbacks', () => {
    const opening = view('turn')
    const history = [
      move(opening, { kind: 'raiseTo', to: 33 }),
      move(view('turn', 'b'), { kind: 'call' }),
    ]
    vi.mocked(publicDecisions).mockImplementation((observation) =>
      observation.street === 'river' ? history : [],
    )
    const { turn, river } = policies()
    turn.policy.decide(context(opening))
    turn.policy.decide(context(view('river', 'a', 166, 33)))
    expect(river.stats.carryUsed).toBe(0)
    expect(river.stats.carryFallbacks).toBe(1)
    expect(river.stats.solved).toBe(1)
    const missing = policies()
    missing.turn.policy.decide(context(view('river', 'a', 166, 33)))
    expect(missing.river.stats.carryFallbacks).toBe(1)
    expect(missing.turn.stats.solves).toBe(0)
  })

  it('leaves carry counters at zero without the flag', () => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const { turn, river } = policies(false)
    turn.policy.decide(context(view('river')))
    expect(river.stats.solved).toBe(1)
    expect(river.stats.carryUsed).toBe(0)
    expect(river.stats.carryFallbacks).toBe(0)
  })

  it('converts pot units to chips in prepared order, drops zero mass, keeps zero-reach deviations', () => {
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
      pot: 100,
      stack: 300,
      ranges: [
        [held('Ac Qc', 2), held('8h 8d')],
        [held('As Qd', 3), held('6h 5h'), held('8h 9h'), held('Kc Qc')],
      ],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const hands = [
      prepare(spot.ranges[0], spot.board),
      prepare(spot.ranges[1], spot.board),
    ] as const
    const record = createRiverPromiseRecord()
    const hook = perRiverShowdown(
      spot,
      () => {
        const values = new Float64Array(COMBOS)
        values[index(held('As Qd'))] = 0.25
        values[index(held('6h 5h'))] = 0.75
        return [new Float64Array(COMBOS).fill(0.5), values]
      },
      record,
    )
    const reach = [Float64Array.of(2, 0), Float64Array.of(3, 0, 1, 1)] as const
    for (const player of [0, 1] as const)
      hook(
        { kind: 'showdown', paid: [30, 30] },
        player,
        hands,
        reach[player],
        reach[player === 0 ? 1 : 0],
        new Float64Array(hands[player].combos.length),
        { history: 'b30c', weight: 1 },
      )
    const river = { ...spot, board: [...spot.board, parseCard('2d')], pot: 160 }
    for (const player of [0, 1] as const) {
      const carry = riverCarryFromRecord(record, 'b30c', cardKey(parseCard('2d')), player, river)
      const opponent = prepare(carry.ranges[player === 0 ? 1 : 0], river.board)
      const actual = opponent.combos.map((h, i) => [index(h), carry.gadget.promises[i]])
      if (player === 0) {
        expect(new Map(actual as [number, number][])).toEqual(
          new Map([
            [index(held('As Qd')), 40],
            [index(held('6h 5h')), 120],
            [index(held('8h 9h')), 0],
          ]),
        )
        expect(opponent.combos.map(index)).not.toEqual(spot.ranges[1].map(index))
        expect(carry.ranges[0].map((h) => h.weight)).toEqual([2])
        expect(opponent.combos.some((h) => index(h) === index(held('6h 5h')))).toBe(true)
      } else {
        expect(carry.gadget.player).toBe(0)
        expect(actual.every(([, value]) => value === 80)).toBe(true)
      }
    }
  })

  it('rejects nearby bet sizes and recognises an exactly matched all-in', () => {
    const spot: RiverSpot = {
      board: cards('Ah Kd 7s 4c'),
      pot: 100,
      stack: 300,
      ranges: [[], []],
      betSizes: [0.5],
      allIn: true,
      maxRaises: 0,
    }
    const tree = riverTree(spot)
    if (tree.kind !== 'action') throw new Error('expected root')
    expect(exactTurnAction(tree, move(view('turn'), { kind: 'raiseTo', to: 50 }), spot)).toBe('b50')
    expect(
      exactTurnAction(tree, move(view('turn'), { kind: 'raiseTo', to: 49 }), spot),
    ).toBeUndefined()
    expect(exactTurnAction(tree, move(view('turn'), { kind: 'raiseTo', to: 300 }), spot)).toBe('a')
    expect(exactTurnAction(tree, move(view('turn'), { kind: 'allIn' }), spot)).toBe('a')
  })

  it('requires an explicit river-network environment setting', () => {
    const previous = process.env.RIVER_RIVER_NETWORK
    try {
      delete process.env.RIVER_RIVER_NETWORK
      expect(() => riverNetworkFromEnvironment()).toThrow('RIVER_RIVER_NETWORK')
    } finally {
      if (previous === undefined) delete process.env.RIVER_RIVER_NETWORK
      else process.env.RIVER_RIVER_NETWORK = previous
    }
  })
})
