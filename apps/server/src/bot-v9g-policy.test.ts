import { type Card, cardKey, championPersonality, mulberry32, parseCard } from '@river/engine'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as flopLeaves from './bot-flop-turn-leaves.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import * as preflop from './bot-preflop-tables.js'
import * as river from './bot-river-policy.js'
import * as solver from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { observationFor, profileFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'
import * as explicit from './bot-turn-explicit-leaf.js'
import * as chain from './bot-turn-policy.js'
import * as residual from './bot-turn-residual.js'
import {
  flopBetSizesFromEnvironment,
  turnExplicitOptionsFromEnvironment,
  turnResidualOptionsFromEnvironment,
  v9gPolicy,
} from './bot-v9g-policy.js'
import * as networks from './bot-value-network.js'

beforeEach(() => {
  vi.stubEnv('RIVER_DIAG_GADGET', undefined)
  vi.stubEnv('RIVER_DIAG_IP_JAM_OVER_RAISE', undefined)
  vi.stubEnv('RIVER_DIAG_ALLIN_RUNOUTS', undefined)
  vi.stubEnv('RIVER_FLOP_BET_SIZES', undefined)
  vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', undefined)
  vi.stubEnv('RIVER_TURN_RESIDUAL', undefined)
  vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', undefined)
})

it.each(['RIVER_DIAG_GADGET', 'RIVER_DIAG_IP_JAM_OVER_RAISE', 'RIVER_DIAG_ALLIN_RUNOUTS'])(
  'rejects invalid diagnostic %s before loading models',
  (name) => {
    vi.stubEnv(name, 'bad')
    expect(() => v9gPolicy()).toThrow(name)
  },
)

it('keeps flop sizes absent by default and forwards the explicit list', () => {
  expect(flopBetSizesFromEnvironment({})).toBeUndefined()
  expect(flopBetSizesFromEnvironment({ RIVER_FLOP_BET_SIZES: '0.33,0.5,0.66,1' })).toEqual([
    0.33, 0.5, 0.66, 1,
  ])
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.stubEnv('RIVER_FLOP_BET_SIZES', '0.33,0.5,0.66,1')
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  v9gPolicy({}, { turn: network, flop: network, turnStart: network, river: network })
  expect(construct.mock.calls[0]?.[2]?.flopBetSizes).toEqual([0.33, 0.5, 0.66, 1])
  expect(construct.mock.calls[0]?.[2]?.betSizes).toBeUndefined()
})

it.each([
  '',
  ' ',
  '0',
  '-1',
  'NaN',
  'Infinity',
  '0.5,',
  '0.5,0.5',
  '1,0.5',
  '0.1,0.2,0.3,0.4,0.5,0.6',
])('rejects invalid flop sizes %s before loading models', (raw) => {
  vi.stubEnv('RIVER_FLOP_BET_SIZES', raw)
  expect(() => v9gPolicy()).toThrow('RIVER_FLOP_BET_SIZES')
})

it.each(['default', 'gadget', 'jam', 'runouts'])(
  'uses flop sizes and diagnostic %s in exact-size re-solves, preserving later streets',
  (diagnostic) => {
    if (diagnostic === 'gadget') vi.stubEnv('RIVER_DIAG_GADGET', 'off')
    if (diagnostic === 'jam') vi.stubEnv('RIVER_DIAG_IP_JAM_OVER_RAISE', '1')
    if (diagnostic === 'runouts') vi.stubEnv('RIVER_DIAG_ALLIN_RUNOUTS', '61')
    const network: networks.RiverValueNetwork = {
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
    vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
    vi.stubEnv('RIVER_FLOP_BET_SIZES', '0.33,0.5,0.66,1')
    const table = preflop.tablePreflopPolicy(pokerGuardPolicy)
    vi.spyOn(preflop, 'tablePreflopPolicy').mockReturnValue({
      ...table,
      ranges: () => [
        ['As Kh', 'Ac Kd'].map((h) => ({
          hole: h.split(' ').map(parseCard) as [Card, Card],
          weight: 0.5,
        })),
        ['Qs Jh', 'Qc Jd'].map((h) => ({
          hole: h.split(' ').map(parseCard) as [Card, Card],
          weight: 0.5,
        })),
      ],
    })
    const calls = vi.spyOn(solver, 'solveRiver')
    const leaves = vi.spyOn(flopLeaves, 'perTurnShowdown')
    const bot = v9gPolicy(
      { offTree: 'resolve', preflopTables: true },
      {
        turn: network,
        flop: network,
        turnStart: network,
        river: network,
      },
    )
    const room = slumbotRoom(
      {
        action: 'b200c/kb172',
        clientPos: 0,
        hole: ['As', 'Kh'].map(parseCard),
        board: ['2h', '7d', 'Ts'].map(parseCard),
      },
      { ours: 'a', theirs: 'b' },
    )
    const o = observationFor(room.viewFor('a'), 'a', undefined, room.id, room.currentActions())
    if (!o) throw new Error('missing observation')
    const explanation = bot.explain(o, championPersonality(), true)
    if (typeof explanation === 'string') throw new Error(explanation)
    expect(explanation.history).toBe('kb172')
    expect(explanation.spot.betSizes).toEqual([0.33, 0.5, 0.66, 1])
    expect(explanation.rangeStrategy).toHaveLength(2)
    expect(bot.stats.offTree.resolves).toBe(1)
    expect(bot.stats.maxSolveMs).toBeGreaterThan(0)
    expect(calls.mock.calls.every(([spot]) => spot.betSizes.join(',') === '0.33,0.5,0.66,1')).toBe(
      true,
    )
    expect(calls.mock.calls.at(-1)?.[5]).toBeDefined()
    const last = calls.mock.calls.at(-1)
    expect(last?.[0]?.ranges).toEqual(calls.mock.calls[0]?.[0]?.ranges)
    expect(last?.[0]?.maxRaises).toBe(1)
    expect(last?.[6]?.fixedStrategies?.get('')).toEqual(
      calls.mock.results[0]?.value.strategy.get(''),
    )
    if (diagnostic === 'gadget') expect(last?.[4]).toBeUndefined()
    else expect(last?.[4]).toBeDefined()
    const widened = last?.[5]
    if (!widened) throw new Error('missing widened tree')
    const ip =
      widened.kind === 'action' ? widened.children[widened.actions.indexOf('k')] : undefined
    const oop = ip?.kind === 'action' ? ip.children[ip.actions.indexOf('b172')] : undefined
    const response = oop?.kind === 'action' ? oop.children[oop.actions.indexOf('b418')] : undefined
    if (response?.kind !== 'action') throw new Error('missing IP response')
    expect(response?.actions.includes('a')).toBe(diagnostic === 'jam')
    expect(
      leaves.mock.calls.every((call) => call[3] === (diagnostic === 'runouts' ? 61 : 60)),
    ).toBe(true)
    expect(explanation.rootCheck).toHaveLength(1326)
    expect(explanation.reach).toHaveLength(1326)
    expect(explanation.ipBetReach).toHaveLength(1326)
    const resolved = calls.mock.results.at(-1)?.value as solver.RiverSolution & {
      followShare?: Float64Array
    }
    const root = calls.mock.results[0]?.value as solver.RiverSolution
    if (root.tree.kind !== 'action' || ip?.kind !== 'action') throw new Error('missing prefix')
    const rootWidth = root.tree.actions.length
    const check = root.tree.actions.indexOf('k')
    for (const [h, combo] of root.spot.ranges[0].entries()) {
      const index = comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
      const frozen = root.strategy.get('')?.[h * rootWidth + check] as number
      expect(explanation.rootCheck?.[index]).toBe(frozen)
      expect(explanation.reach?.[index]).toBe(combo.weight * frozen)
    }
    for (const [h, combo] of resolved.spot.ranges[1].entries()) {
      const index = comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
      const follow = diagnostic === 'gadget' ? combo.weight : (resolved.followShare?.[h] as number)
      const bet = resolved.strategy.get('k')?.[h * ip.actions.length + ip.actions.indexOf('b172')]
      expect(explanation.ipBetReach?.[index]).toBe(follow * (bet as number))
    }
    // An isolated turn using the same overrides still receives the default sizes.
    const turnRoom = slumbotRoom(
      {
        action: 'b200c/kk/',
        clientPos: 0,
        hole: ['As', 'Kh'].map(parseCard),
        board: ['2h', '7d', 'Ts', '3c'].map(parseCard),
      },
      { ours: 'a', theirs: 'b' },
    )
    const turnView = observationFor(
      turnRoom.viewFor('a'),
      'a',
      undefined,
      turnRoom.id,
      turnRoom.currentActions(),
    )
    if (!turnView) throw new Error('missing turn observation')
    const turnSpots: solver.RiverSpot[] = []
    const turn = chain.turnSolverPolicy(
      table.policy,
      network,
      'fixture',
      1,
      { flopBetSizes: [0.33, 0.5, 0.66, 1] },
      {
        ...chain.TURN_STREET,
        solve: (spot) => {
          turnSpots.push(spot)
          return solver.solveRiver(spot, 1)
        },
      },
    )
    turn.explain(turnView, championPersonality())
    expect(turnSpots[0]?.betSizes).toEqual([0.66])
    expect(bot.river.solves).toBe(0)
  },
  60000,
)

it('keeps explicit leaves opt-in and rejects conflicts with residual leaves', () => {
  expect(turnExplicitOptionsFromEnvironment({})).toBeUndefined()
  expect(turnExplicitOptionsFromEnvironment({ RIVER_TURN_EXPLICIT_LEAF: 'never' })).toEqual({
    refreshIterations: 'never',
  })
  expect(turnExplicitOptionsFromEnvironment({ RIVER_TURN_EXPLICIT_LEAF: '20' })).toEqual({
    refreshIterations: 20,
  })
  vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', 'never')
  vi.stubEnv('RIVER_TURN_RESIDUAL', 'fixture')
  expect(() => v9gPolicy()).toThrow('mutually exclusive')
})

it.each(['', '0', '-1', '1.5', '2x', ' 2', '2e1', '9007199254740992'])(
  'rejects invalid explicit leaf refresh %s before loading models',
  (refresh) => {
    vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', refresh)
    expect(() => v9gPolicy()).toThrow('RIVER_TURN_EXPLICIT_LEAF')
  },
)

it('constructs separate explicit caches with the live turn configuration', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  const shared = { turn: network, flop: network, turnStart: network, river: network }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', 'never')
  const leaf = vi.spyOn(explicit, 'explicitTurnSolveLeaf')
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  v9gPolicy({}, shared)
  v9gPolicy({ resolveIterationMultiplier: 10 }, shared)
  expect(leaf.mock.calls.map((call) => call[2])).toEqual(
    [40, 400].map((iterations) => ({
      refreshIterations: 'never',
      iterations,
      betSizes: chain.TURN_POLICY_TUNING.betSizes,
      maxRaises: chain.TURN_POLICY_TUNING.maxRaises,
      allIn: true,
      scheme: 'dcfr',
    })),
  )
  expect(construct.mock.calls[0]?.[2]?.turnStartLeaf?.network).toBe(leaf.mock.results[0]?.value)
  expect(leaf.mock.results[0]?.value).not.toBe(leaf.mock.results[1]?.value)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('keeps the residual opt-in absent when its stem is unset', () => {
  expect(turnResidualOptionsFromEnvironment({})).toBeUndefined()
  expect(turnResidualOptionsFromEnvironment({ RIVER_TURN_RESIDUAL_REFRESH: '20' })).toBeUndefined()
})

it('keeps production iterations at 40 and scales only flop/turn on explicit replay opt-in', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  const shared = { turn: network, flop: network, turnStart: network, river: network }
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const rivers = vi.spyOn(river, 'riverSolverPolicy')
  v9gPolicy({}, shared)
  v9gPolicy({ resolveIterationMultiplier: 1 }, shared)
  v9gPolicy({ resolveIterationMultiplier: 10, offTree: 'resolve' }, shared)
  expect(construct.mock.calls[0]).toEqual(construct.mock.calls[1])
  expect(construct.mock.calls.map((call) => call[2]?.iterations)).toEqual([40, 40, 400])
  expect(construct.mock.calls[2]?.[2]).toMatchObject({ offTree: 'resolve', scheme: 'dcfr' })
  expect(rivers.mock.calls.map((call) => call[3]?.iterations)).toEqual([
    river.RIVER_CANDIDATE_TUNING.iterations,
    river.RIVER_CANDIDATE_TUNING.iterations,
    river.RIVER_CANDIDATE_TUNING.iterations,
  ])
})

it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER])(
  'rejects iteration multiplier %s',
  (multiplier) => {
    expect(() => v9gPolicy({ resolveIterationMultiplier: multiplier })).toThrow(
      'resolveIterationMultiplier',
    )
  },
)

it.each([
  [undefined, 'never'],
  ['never', 'never'],
  ['20', 20],
] as const)('parses residual refresh %s as %s', (refresh, expected) => {
  expect(
    turnResidualOptionsFromEnvironment({
      RIVER_TURN_RESIDUAL: 'fixture/residual-0',
      RIVER_TURN_RESIDUAL_REFRESH: refresh,
    }),
  ).toEqual({ stem: 'fixture/residual-0', refreshIterations: expected })
})

it.each(['', '0', '-1', '1.5', '20x', 'NaN', 'Infinity', ' 20', '2e1', '9007199254740992'])(
  'rejects invalid refresh %s at construction, even without a stem',
  (refresh) => {
    vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', refresh)
    expect(() => v9gPolicy()).toThrow('RIVER_TURN_RESIDUAL_REFRESH')
  },
)

it.each(['', ' ', ' fixture'])('rejects invalid residual stem %s', (stem) => {
  expect(() => turnResidualOptionsFromEnvironment({ RIVER_TURN_RESIDUAL: stem })).toThrow(
    'RIVER_TURN_RESIDUAL',
  )
})

it.each(['never', '20'])(
  'shares residual weights but owns leaf caches with refresh %s',
  (refresh) => {
    const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
    const weights = { bucket: network, residual: network }
    vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
    vi.stubEnv('RIVER_TURN_RESIDUAL', 'fixture/residual-0')
    vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', refresh)
    const load = vi.spyOn(residual, 'loadTurnResidualNetwork').mockReturnValue(weights)
    const leaf = vi.spyOn(residual, 'turnResidualLeaf')
    const construct = vi.spyOn(chain, 'solvedFlopPolicy')
    const live = v9gPolicy(
      { offTree: 'resolve' },
      { turn: network, flop: network, turnStart: network, river: network },
    )
    const query = v9gPolicy({ offTree: 'resolve' }, live.networks)
    expect(load).toHaveBeenCalledExactlyOnceWith('fixture/residual-0')
    expect(query.networks).toBe(live.networks)
    expect(live.networks.turnResidual).toBe(weights)
    expect(leaf).toHaveBeenCalledTimes(2)
    for (const call of leaf.mock.calls)
      expect(call).toEqual([weights, { refreshIterations: refresh === 'never' ? 'never' : 20 }])
    const first = construct.mock.calls[0]?.[2]?.turnStartLeaf?.network
    const second = construct.mock.calls[1]?.[2]?.turnStartLeaf?.network
    expect(first).toBe(leaf.mock.results[0]?.value)
    expect(second).toBe(leaf.mock.results[1]?.value)
    expect(first).not.toBe(second)
  },
)

it('does not load residual weights or add leaf options when unset', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  const load = vi.spyOn(residual, 'loadTurnResidualNetwork')
  const leaf = vi.spyOn(residual, 'turnResidualLeaf')
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const shared = { turn: network, flop: network, turnStart: network, river: network }
  const result = v9gPolicy({ offTree: 'resolve' }, shared)
  expect(result.networks).toBe(shared)
  expect(load).not.toHaveBeenCalled()
  expect(leaf).not.toHaveBeenCalled()
  expect(construct.mock.calls[0]).toEqual([
    network,
    network,
    {
      carry: 'both',
      turnStartNetwork: network,
      riverNetwork: network,
      scheme: 'dcfr',
      iterations: 40,
      boundedReads: false,
      offTree: 'resolve',
    },
  ])
})

it('forwards only the explicit turn-start leaf opt-in', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const turnStartLeaf = { network, earlyNetwork: network, lastIterations: 5 }
  v9gPolicy(
    { offTree: 'resolve', turnStartLeaf },
    {
      turn: network,
      flop: network,
      river: network,
      turnStart: network,
    },
  )
  expect(construct.mock.calls[0]?.[2]?.turnStartLeaf).toBe(turnStartLeaf)
})

it('shares injected inference weights while giving each query seat independent solve state', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  const flop = vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  const turn = vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  const start = vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  const riverNetwork = vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const live = v9gPolicy()
  const query = v9gPolicy({}, live.networks)
  for (const loader of [flop, turn, start, riverNetwork]) expect(loader).toHaveBeenCalledTimes(1)
  expect(query.networks).toBe(live.networks)
  expect(query.policy).not.toBe(live.policy)
  expect(query.stats).not.toBe(live.stats)
  expect(query.turn).not.toBe(live.turn)
  expect(query.river).not.toBe(live.river)
})

it('leaves v9go identical with preflopTables absent or false; only v9gp opts in', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const tables = vi.spyOn(preflop, 'tablePreflopPolicy')
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const original = v9gPolicy({ offTree: 'resolve' })
  const disabled = v9gPolicy({ offTree: 'resolve', preflopTables: false })
  expect(tables).not.toHaveBeenCalled()
  expect(original.preflop).toBeUndefined()
  expect(disabled.preflop).toBeUndefined()
  expect(construct.mock.calls[0]).toEqual(construct.mock.calls[1])
  const room = slumbotRoom(
    { action: '', clientPos: 1, hole: ['7h', '2d'].map(parseCard), board: [] },
    { ours: 'a', theirs: 'b' },
  )
  const observation = observationFor(
    room.viewFor('a'),
    'a',
    undefined,
    room.id,
    room.currentActions(),
  )
  if (!observation) throw new Error('missing observation')
  const personality = championPersonality()
  for (let seed = 1; seed <= 100; seed++) {
    const context = {
      observation,
      personality,
      profile: profileFor(personality),
      tilt: observation.tilt,
      rng: mulberry32(seed),
    }
    expect(original.policy.decide(context)).toEqual(
      disabled.policy.decide({ ...context, rng: mulberry32(seed) }),
    )
  }
  const enabled = v9gPolicy({ offTree: 'resolve', preflopTables: true })
  expect(tables).toHaveBeenCalledTimes(1)
  expect(enabled.preflop).toBeDefined()
  expect(construct.mock.calls[2]?.[2]?.preflop?.stats).toBe(enabled.preflop)
})

it('shares the original v9g construction and forwards only the explicit bounded river opt-in', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const rivers = vi.spyOn(river, 'riverSolverPolicy')
  v9gPolicy()
  v9gPolicy({ boundedReads: false })
  v9gPolicy({ boundedReads: true })
  v9gPolicy({ offTree: 'resolve' })
  const original = {
    carry: 'both',
    turnStartNetwork: network,
    riverNetwork: network,
    scheme: 'dcfr',
    iterations: 40,
  }
  for (let i = 0; i < 3; i++) {
    expect(construct.mock.calls[i]).toEqual([
      network,
      network,
      { ...original, boundedReads: i === 2 },
    ])
    expect(rivers.mock.calls[i]?.[3]?.boundedReads).toBe(i === 2)
    expect(rivers.mock.calls[i]?.[3]?.carry).toBe('per-river')
    expect(rivers.mock.calls[i]?.[3]?.safe).toBe(true)
  }
  expect(construct.mock.calls[3]).toEqual([
    network,
    network,
    { ...original, boundedReads: false, offTree: 'resolve' },
  ])
  expect(rivers.mock.calls[3]?.[3]?.offTree).toBe('resolve')
  expect(rivers.mock.calls.slice(0, 3).every((call) => call[3]?.offTree === undefined)).toBe(true)
})

it.each([0.35, 0.5])(
  'constructs the hybrid at threshold %s and exposes both river counters',
  (threshold) => {
    const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
    vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
    vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
    vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
    vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
    vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
    const wrapper = vi.spyOn(chain, 'predictableHybridPolicy')
    const result = v9gPolicy({ hybridThreshold: threshold })
    expect(wrapper.mock.calls[0]?.[2]).toBe(threshold)
    expect(result.hybrid).toEqual({ switches: 0, turn: 0, river: 0 })
    expect(result.exploitRiver).toBeDefined()
    expect(result.exploitRiver).not.toBe(result.river)
  },
)

it('forwards the v9gy baseline-cap opt-in to the carried river without changing the chain', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const rivers = vi.spyOn(river, 'riverSolverPolicy')
  const result = v9gPolicy({ boundedReads: true, baselineCaps: true })
  expect(rivers.mock.calls[0]?.[3]).toMatchObject({
    boundedReads: true,
    baselineCaps: true,
    safe: true,
    carry: 'per-river',
    scheme: 'dcfr',
  })
  expect(result.hybrid).toBeUndefined()
})

it('v9gz enables only river optimization; flag off has identical v9gp construction', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const rivers = vi.spyOn(river, 'riverSolverPolicy')
  const turns = vi.spyOn(chain, 'solvedFlopPolicy')
  const options = { offTree: 'resolve' as const, preflopTables: true }
  v9gPolicy(options)
  v9gPolicy({ ...options, safeExploitV2: false })
  expect(rivers.mock.calls[0]?.[3]).toEqual(rivers.mock.calls[1]?.[3])
  // Fresh table closures differ by identity; all other chain options match.
  const { preflop: _a, ...a } = turns.mock.calls[0]?.[2] ?? {}
  const { preflop: _b, ...b } = turns.mock.calls[1]?.[2] ?? {}
  expect(a).toEqual(b)
  const enabled = v9gPolicy({ ...options, safeExploitV2: true })
  expect(rivers.mock.calls[2]?.[3]).toMatchObject({
    safeExploitV2: true,
    safe: true,
    carry: 'per-river',
    offTree: 'resolve',
  })
  expect(enabled.preflop).toBeDefined()
  expect(enabled.river.safeExploit).toMatchObject({ eligible: 0, proposed: 0, accepted: 0 })
  expect(enabled.hybrid).toBeUndefined()
})

it('v9gz2 independently enables turn and river while explicit turn-off keeps v9gp construction', () => {
  const network: networks.RiverValueNetwork = { buckets: 1, layers: [] }
  vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
  vi.spyOn(networks, 'loadValueNetwork').mockReturnValue(network)
  vi.spyOn(networks, 'turnNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'turnStartNetworkFromEnvironment').mockReturnValue(network)
  vi.spyOn(networks, 'riverNetworkFromEnvironment').mockReturnValue(network)
  const construct = vi.spyOn(chain, 'solvedFlopPolicy')
  const options = { offTree: 'resolve' as const, preflopTables: true }
  v9gPolicy(options)
  v9gPolicy({ ...options, safeTurnExploit: false, safeExploitV2: false })
  const { preflop: _a, ...a } = construct.mock.calls[0]?.[2] ?? {}
  const { preflop: _b, ...b } = construct.mock.calls[1]?.[2] ?? {}
  expect(a).toEqual(b)
  const enabled = v9gPolicy({ ...options, safeTurnExploit: true, safeExploitV2: true })
  expect(construct.mock.calls[2]?.[2]).toMatchObject({ safeTurnExploit: true, safeExploitV2: true })
  expect(enabled.turn.safeExploit).toMatchObject({ eligible: 0, proposed: 0, accepted: 0 })
})
