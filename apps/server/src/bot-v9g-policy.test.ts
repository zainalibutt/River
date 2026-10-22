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
  v9gPolicy(false)
  v9gPolicy(true)
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
})
