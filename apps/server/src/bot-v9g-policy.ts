import { solvedFlopPolicy } from './bot-turn-policy.js'
import {
  loadValueNetwork,
  riverNetworkFromEnvironment,
  turnNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'

/** Shared table/shark construction; v9gx changes only the bounded river flag. */
export function v9gPolicy(boundedReads = false) {
  const flop = process.env.RIVER_FLOP_NETWORK
  if (!flop) throw new Error('v9g needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
  return solvedFlopPolicy(turnNetworkFromEnvironment(), loadValueNetwork(flop), {
    carry: 'both',
    turnStartNetwork: turnStartNetworkFromEnvironment(),
    riverNetwork: riverNetworkFromEnvironment(),
    scheme: 'dcfr',
    iterations: 40,
    boundedReads,
  })
}
