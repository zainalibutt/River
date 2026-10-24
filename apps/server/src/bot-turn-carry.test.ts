import {
  type BotObservationV1,
  type Card,
  cardKey,
  mulberry32,
  parseCard,
  personalityPool,
} from '@river/engine'
import { describe, expect, it, vi } from 'vitest'
import { createTurnPromiseRecord, perTurnShowdown } from './bot-flop-turn-leaves.js'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { carryFromRecord, exactTurnAction } from './bot-river-carry.js'
import * as riverPolicy from './bot-river-policy.js'
import * as solver from './bot-river-solver.js'
import { prepare, type RangeCombo, type RiverSpot, riverTree } from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import * as safeTurn from './bot-safe-turn-exploitation.js'
import { profileFor } from './bot-service.js'
import { FLOP_STREET, solvedFlopPolicy, TURN_STREET, turnSolverPolicy } from './bot-turn-policy.js'
import { type RiverValueNetwork, turnStartNetworkFromEnvironment } from './bot-value-network.js'

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

function view(street: 'flop' | 'turn', playerId = 'a', pot = 100, paid = 0): BotObservationV1 {
  return {
    version: 1,
    roomId: 'carry-test',
    handNumber: 1,
    street,
    board: cards(street === 'flop' ? 'Ah Kd 7s' : 'Ah Kd 7s 2d'),
    dealerSeat: 1,
    actor: {
      playerId,
      seat: playerId === 'a' ? 0 : 1,
      hole: cards('Ac Qc'),
      stack: 300 - paid,
      betHand: paid,
      betStreet: street === 'flop' ? paid : 0,
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
      betStreet: street === 'flop' ? paid : 0,
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

describe('v9gz2 fixed turn continuation wiring', () => {
  it('zero turn budget and flag-off preserve decisions and RNG exactly', () => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const observation = view('turn')
    const options = {
      carry: 'both' as const,
      riverNetwork: network,
      offTree: 'resolve' as const,
      iterations: 2,
      betSizes: [0.5],
      maxRaises: 0,
    }
    const original = turnSolverPolicy(legacyGuardPolicy, network, 'test', 1, options)
    const disabled = turnSolverPolicy(legacyGuardPolicy, network, 'test', 1, {
      ...options,
      safeTurnExploit: false,
    })
    const zero = turnSolverPolicy(legacyGuardPolicy, network, 'test', 1, {
      ...options,
      safeTurnExploit: true,
      safeTurnExploitConfig: { turnBudgetBb: 0 },
    })
    for (let seed = 0; seed < 12; seed++) {
      const run = (bot: typeof original) => {
        const rng = mulberry32(seed)
        let draws = 0
        const result = bot.policy.decide({
          ...context(observation),
          rng: () => {
            draws++
            return rng()
          },
        })
        return { result, draws }
      }
      expect(run(zero)).toEqual(run(original))
      expect(run(disabled)).toEqual(run(original))
    }
    expect(zero.stats.safeExploit).toMatchObject({ eligible: 1, proposed: 0, accepted: 0 })
    expect(disabled.stats.safeExploit.eligible).toBe(0)
  })

  it('plays a selected row once but keeps tracking, carry and off-tree prefixes on the shadow policy', () => {
    vi.mocked(publicDecisions).mockReturnValue([])
    const read = {
      bet: 0,
      fold: 1,
      raise: 0,
      foldSmall: 1,
      foldMedium: 1,
      foldLarge: 1,
      air: 0,
      size: 0.5,
      trust: 0.8,
    }
    const readsSpy = vi.spyOn(riverPolicy, 'riverReads').mockReturnValue(read)
    const proposal = vi
      .spyOn(safeTurn, 'solveBudgetedTurnDecision')
      .mockImplementation((baseline, node) => {
        const table = new Float64Array(baseline.strategy.get(node.history)?.length ?? 0)
        for (let h = 0; h < table.length / node.actions.length; h++)
          table[h * node.actions.length + 1] = 1
        return {
          table,
          weight: 1,
          maxBRIncrease: 0,
          actionTV: 0.1,
          auditFailures: 0,
          modelEVGain: 1,
          modelWeight: 0.35,
          proposed: true,
        }
      })
    try {
      const original = view('turn')
      const observation = {
        ...original,
        seats: original.seats.map((s) => ({ ...s, betHand: s.seat === 0 ? 50 : 100 })),
      }
      const options = {
        carry: 'both' as const,
        riverNetwork: network,
        offTree: 'resolve' as const,
        iterations: 2,
        betSizes: [0.5],
        maxRaises: 0,
      }
      const baseline = turnSolverPolicy(legacyGuardPolicy, network, 'test', 1, options)
      const adapted = turnSolverPolicy(legacyGuardPolicy, network, 'test', 1, {
        ...options,
        safeTurnExploit: true,
      })
      const first = adapted.policy.decide(context(observation))
      expect(first.decision.kind).toBe('raiseTo')
      expect(adapted.stats.safeExploit).toMatchObject({ eligible: 1, accepted: 1 })
      const past = move(observation, { kind: 'check' })
      const expected = baseline.ownShares(past, 'passive', person, true)
      const actual = adapted.ownShares(past, 'passive', person, true)
      expect(expected).not.toBeNull()
      expect(actual?.(observation.actor.hole as [Card, Card])).toBe(
        expected?.(observation.actor.hole as [Card, Card]),
      )
      // Changed evidence cannot buy a second turn budget or change the row.
      readsSpy.mockReturnValue({ ...read, fold: 0, trust: 0.1 })
      expect(adapted.policy.decide(context(observation))).toEqual(first)
      expect(proposal).toHaveBeenCalledTimes(1)
      const history = [
        move(observation, { kind: 'check' }),
        move(view('turn', 'b'), { kind: 'check' }),
      ]
      const river = {
        ...observation,
        street: 'river' as const,
        board: [...observation.board, parseCard('3d')],
      }
      vi.mocked(publicDecisions).mockReturnValue(history)
      expect(adapted.carried(river, person, history, ['a', 'b'])).toEqual(
        baseline.carried(river, person, history, ['a', 'b']),
      )
      const offTreeHistory = [
        move(observation, { kind: 'check' }),
        move(view('turn', 'b'), { kind: 'raiseTo', to: 43 }),
      ]
      vi.mocked(publicDecisions).mockReturnValue(offTreeHistory)
      const reply = {
        ...observation,
        pot: 143,
        currentBet: 43,
        amountToCall: 43,
        seats: observation.seats.map((s) =>
          s.playerId === 'b' ? { ...s, stack: 257, betStreet: 43, betHand: s.betHand + 43 } : s,
        ),
      }
      expect(adapted.policy.decide(context(reply))).toEqual(baseline.policy.decide(context(reply)))
      expect(adapted.stats.offTree.resolves).toBe(1)
      expect(adapted.stats.safeExploit.eligible).toBe(1)
      expect(proposal).toHaveBeenCalledTimes(1)
    } finally {
      proposal.mockRestore()
      readsSpy.mockRestore()
    }
  })
})

describe.each(['cfr+', 'dcfr'] as const)('%s policy carry', (scheme) => {
  function policies(carry = true, safeTurn = false) {
    let turn: ReturnType<typeof turnSolverPolicy> | undefined
    const river = turnSolverPolicy(
      legacyGuardPolicy,
      network,
      'turn-test',
      1,
      {
        scheme,
        iterations: 2,
        betSizes: [],
        maxRaises: 0,
        ...(carry ? { carry: 'per-turn' as const } : {}),
      },
      {
        ...TURN_STREET,
        safe: true,
        carry: (observation, personality, history, players) =>
          turn?.carried(observation, personality, history, players) ?? null,
      },
    )
    turn = turnSolverPolicy(
      river.policy,
      network,
      'turn-test',
      1,
      {
        scheme,
        // The cache fixture needs a supported check-check line. Sampling the
        // other traversal can give it zero reach in a two-iteration gadget.
        iterations: safeTurn ? 8 : 2,
        betSizes: [0.5],
        maxRaises: 0,
        ...(carry ? { carry: 'per-turn' as const, turnStartNetwork: network } : {}),
      },
      { ...FLOP_STREET, safe: safeTurn },
    )
    return { turn, river }
  }

  describe('opt-in flop-to-turn policy carry', () => {
    it('wires both boundaries in the v9f composition without refreshing either promise', () => {
      const flop = view('flop')
      const turn = view('turn')
      const river: BotObservationV1 = {
        ...turn,
        street: 'river',
        board: [...turn.board, parseCard('3d')],
      }
      const flopHistory = [
        move(flop, { kind: 'check' }),
        move(view('flop', 'b'), { kind: 'check' }),
      ]
      const turnHistory = [
        ...flopHistory,
        move(turn, { kind: 'check' }),
        move(view('turn', 'b'), { kind: 'check' }),
      ]
      vi.mocked(publicDecisions).mockImplementation((observation) =>
        observation.street === 'river'
          ? turnHistory
          : observation.street === 'turn'
            ? flopHistory
            : [],
      )
      const chain = solvedFlopPolicy(network, network, {
        carry: 'both',
        turnStartNetwork: network,
        riverNetwork: network,
        scheme,
        iterations: 2,
        betSizes: [],
        maxRaises: 0,
      })
      for (const observation of [flop, turn, river]) chain.policy.decide(context(observation))
      expect(chain.stats.solves).toBe(1)
      expect(chain.turn.carryUsed).toBe(1)
      expect(chain.turn.carryFallbacks).toBe(0)
      expect(chain.river.carryUsed).toBe(1)
      expect(chain.river.carryFallbacks).toBe(0)
    }, 30_000)

    it('pins active records across rooms and releases only the settled hand', () => {
      vi.mocked(publicDecisions).mockReturnValue([])
      const chain = solvedFlopPolicy(network, network, {
        carry: 'both',
        turnStartNetwork: network,
        riverNetwork: network,
        scheme,
        iterations: 2,
        betSizes: [],
        maxRaises: 0,
        cacheSize: 0,
      })
      const first = view('flop')
      const second = { ...first, roomId: 'other-room' }
      chain.policy.decide(context(first))
      chain.policy.decide(context(second))
      expect(chain.cacheMemory().records).toBe(2)
      const history = [move(first, { kind: 'check' }), move(view('flop', 'b'), { kind: 'check' })]
      const turn = view('turn')
      const before = chain.carried(turn, person, history, ['a', 'b'])
      expect(before).not.toBeNull()
      chain.policy.releaseHand(second.roomId, second.handNumber)
      expect(chain.cacheMemory().records).toBe(1)
      expect(chain.carried(turn, person, history, ['a', 'b'])).toEqual(before)
      chain.policy.releaseHand(first.roomId, first.handNumber)
      expect(chain.cacheMemory().recordBytes).toBe(0)
      expect(chain.cacheMemory().entries).toBe(0)
      expect(chain.carried(turn, person, history, ['a', 'b'])).toBeNull()
      // Released promises are never regenerated by a carry-only lookup.
      expect(chain.stats.solves).toBe(2)
    }, 30_000)

    it('releases the previous live hand on a new preflop observation', () => {
      vi.mocked(publicDecisions).mockReturnValue([])
      const { turn } = policies()
      turn.policy.decide(context(view('flop')))
      expect(turn.cacheMemory().recordBytes).toBeGreaterThan(0)
      const next: BotObservationV1 = {
        ...view('flop'),
        street: 'preflop',
        board: [],
        handNumber: 2,
      }
      turn.policy.decide(context(next))
      expect(turn.cacheMemory().records).toBe(0)
      expect(turn.cacheMemory().bytes).toBe(0)
    })
    it.each([false, true])(
      'uses a cached exact flop leaf (turn gadget=%s) and counts the carried turn solve',
      (safeTurn) => {
        const opening = view('flop')
        const riverView = view('turn')
        const history = [
          move(opening, { kind: 'check' }),
          move(view('flop', 'b'), { kind: 'check' }),
        ]
        vi.mocked(publicDecisions).mockImplementation((observation) =>
          observation.street === 'turn' ? history : [],
        )
        const { turn, river } = policies(true, safeTurn)
        turn.policy.decide(context(opening))
        expect(turn.stats.solves).toBe(1)
        const expected = turn.carried(riverView, person, history, ['a', 'b'])
        expect(expected).not.toBeNull()
        const solve = vi.spyOn(solver, 'solveRiver')
        try {
          turn.policy.decide(context(riverView))
          // A carried solve skips solve A, and passes the exact two recorded
          // reaches and chip-valued gadget, not merely a success counter.
          expect(solve).toHaveBeenCalledTimes(1)
          expect(solve.mock.calls[0]?.[0].ranges).toEqual(expected?.ranges)
          expect(solve.mock.calls[0]?.[4]).toEqual(expected?.gadget)
          expect(solve.mock.calls[0]?.[6]?.scheme).toBe(scheme)
        } finally {
          solve.mockRestore()
        }
        expect(turn.stats.solves).toBe(1) // a carry lookup must not create another turn solve
        expect(river.stats.carryUsed).toBe(1)
        expect(river.stats.carryFallbacks).toBe(0)
        expect(river.stats.solved).toBe(1)
        turn.policy.decide(context(riverView))
        expect(river.stats.carryUsed).toBe(1) // counters measure solves, not cached decisions
      },
      30_000,
    )

    it('carries an exact called flop bet into the increased turn pot', () => {
      const opening = view('flop')
      const history = [
        move(opening, { kind: 'raiseTo', to: 50 }),
        move(view('flop', 'b'), { kind: 'call' }),
      ]
      vi.mocked(publicDecisions).mockImplementation((observation) =>
        observation.street === 'turn' ? history : [],
      )
      const { turn, river } = policies()
      turn.policy.decide(context(opening))
      turn.policy.decide(context(view('turn', 'a', 200, 50)))
      expect(river.stats.carryUsed).toBe(1)
      expect(river.stats.carryFallbacks).toBe(0)
      expect(river.stats.solved).toBe(1)
    })

    it('counts an off-tree size and a missing cached record as fallbacks', () => {
      const opening = view('flop')
      const history = [
        move(opening, { kind: 'raiseTo', to: 33 }),
        move(view('flop', 'b'), { kind: 'call' }),
      ]
      vi.mocked(publicDecisions).mockImplementation((observation) =>
        observation.street === 'turn' ? history : [],
      )
      const { turn, river } = policies()
      turn.policy.decide(context(opening))
      turn.policy.decide(context(view('turn', 'a', 166, 33)))
      expect(river.stats.carryUsed).toBe(0)
      expect(river.stats.carryFallbacks).toBe(1)
      expect(river.stats.solved).toBe(1)
      const missing = policies()
      missing.turn.policy.decide(context(view('turn', 'a', 166, 33)))
      expect(missing.river.stats.carryFallbacks).toBe(1)
      expect(missing.turn.stats.solves).toBe(0)
    }, 30_000)

    it('leaves carry counters at zero without the flag', () => {
      vi.mocked(publicDecisions).mockReturnValue([])
      const { turn, river } = policies(false)
      turn.policy.decide(context(view('turn')))
      expect(river.stats.solved).toBe(1)
      expect(river.stats.carryUsed).toBe(0)
      expect(river.stats.carryFallbacks).toBe(0)
    })

    it('converts pot units to chips in prepared order, drops zero mass, keeps zero-reach deviations', () => {
      const spot: RiverSpot = {
        board: cards('Ah Kd 7s'),
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
      const record = createTurnPromiseRecord()
      const hook = perTurnShowdown(
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
        const carry = carryFromRecord(record, 'b30c', cardKey(parseCard('2d')), player, river)
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
        board: cards('Ah Kd 7s'),
        pot: 100,
        stack: 300,
        ranges: [[], []],
        betSizes: [0.5],
        allIn: true,
        maxRaises: 0,
      }
      const tree = riverTree(spot)
      if (tree.kind !== 'action') throw new Error('expected root')
      expect(exactTurnAction(tree, move(view('flop'), { kind: 'raiseTo', to: 50 }), spot)).toBe(
        'b50',
      )
      expect(
        exactTurnAction(tree, move(view('flop'), { kind: 'raiseTo', to: 49 }), spot),
      ).toBeUndefined()
      expect(exactTurnAction(tree, move(view('flop'), { kind: 'raiseTo', to: 300 }), spot)).toBe(
        'a',
      )
      expect(exactTurnAction(tree, move(view('flop'), { kind: 'allIn' }), spot)).toBe('a')
    })

    it('requires an explicit turn-start-network environment setting', () => {
      const previous = process.env.RIVER_TURN_START_NETWORK
      try {
        delete process.env.RIVER_TURN_START_NETWORK
        expect(() => turnStartNetworkFromEnvironment()).toThrow('RIVER_TURN_START_NETWORK')
      } finally {
        if (previous === undefined) delete process.env.RIVER_TURN_START_NETWORK
        else process.env.RIVER_TURN_START_NETWORK = previous
      }
    })
  })
})
