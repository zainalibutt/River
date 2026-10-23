import { afterEach, expect, it, vi } from 'vitest'
import * as river from './bot-river-policy.js'
import * as chain from './bot-turn-policy.js'
import { v9gPolicy } from './bot-v9g-policy.js'
import * as networks from './bot-value-network.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
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
