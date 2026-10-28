import { championPersonality, mulberry32, parseCard } from '@river/engine'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as preflop from './bot-preflop-tables.js'
import * as river from './bot-river-policy.js'
import { observationFor, profileFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'
import * as chain from './bot-turn-policy.js'
import * as residual from './bot-turn-residual.js'
import { turnResidualOptionsFromEnvironment, v9gPolicy } from './bot-v9g-policy.js'
import * as networks from './bot-value-network.js'

beforeEach(() => {
  vi.stubEnv('RIVER_TURN_RESIDUAL', undefined)
  vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('keeps the residual opt-in absent when its stem is unset', () => {
  expect(turnResidualOptionsFromEnvironment({})).toBeUndefined()
  expect(turnResidualOptionsFromEnvironment({ RIVER_TURN_RESIDUAL_REFRESH: '20' })).toBeUndefined()
})

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
