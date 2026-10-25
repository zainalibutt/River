import { pokerGuardPolicy } from './bot-poker-guard.js'
import { tablePreflopPolicy } from './bot-preflop-tables.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import type { SafeExploitConfig } from './bot-safe-exploitation.js'
import type { SafeTurnExploitConfig } from './bot-safe-turn-exploitation.js'
import { predictableHybridPolicy, solvedFlopPolicy } from './bot-turn-policy.js'
import {
  loadValueNetwork,
  type RiverValueNetwork,
  riverNetworkFromEnvironment,
  turnNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'

export interface V9gOptions {
  readonly offTree?: 'resolve'
  readonly boundedReads?: boolean
  readonly baselineCaps?: boolean
  readonly hybridThreshold?: number
  readonly preflopTables?: boolean
  readonly safeExploitV2?: boolean
  readonly safeTurnExploit?: boolean
  readonly safeTurnExploitConfig?: Partial<SafeTurnExploitConfig>
  readonly safeExploitConfig?: Partial<SafeExploitConfig>
}

/** Only immutable inference weights are shared; each construction owns its solves. */
export interface V9gNetworks {
  readonly turn: RiverValueNetwork
  readonly flop: RiverValueNetwork
  readonly turnStart: RiverValueNetwork
  readonly river: RiverValueNetwork
}

/** Shared table/shark construction for the carried chain and its opt-in variants. */
export function v9gPolicy(
  {
    offTree,
    boundedReads = false,
    baselineCaps,
    hybridThreshold,
    preflopTables = false,
    safeExploitV2 = false,
    safeTurnExploit = false,
    safeTurnExploitConfig,
    safeExploitConfig,
  }: V9gOptions = {},
  sharedNetworks?: V9gNetworks,
) {
  const flop = process.env.RIVER_FLOP_NETWORK
  if (!flop) throw new Error('v9g needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
  const preflop = preflopTables ? tablePreflopPolicy(pokerGuardPolicy) : undefined
  const networks = sharedNetworks ?? {
    turn: turnNetworkFromEnvironment(),
    flop: loadValueNetwork(flop),
    turnStart: turnStartNetworkFromEnvironment(),
    river: riverNetworkFromEnvironment(),
  }
  const chain = solvedFlopPolicy(networks.turn, networks.flop, {
    carry: 'both',
    turnStartNetwork: networks.turnStart,
    riverNetwork: networks.river,
    scheme: 'dcfr',
    iterations: 40,
    boundedReads,
    ...(safeExploitV2 ? { safeExploitV2, safeExploitConfig } : {}),
    ...(safeTurnExploit ? { safeTurnExploit, safeTurnExploitConfig } : {}),
    ...(preflop === undefined ? {} : { preflop }),
    ...(offTree === undefined ? {} : { offTree }),
    ...(baselineCaps === undefined ? {} : { baselineCaps }),
  })
  if (hybridThreshold === undefined)
    return {
      ...chain,
      networks,
      preflop: preflop?.stats,
      hybrid: undefined,
      exploitRiver: undefined,
    }
  const exploit = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
  const hybrid = predictableHybridPolicy(chain.policy, exploit.policy, hybridThreshold)
  return {
    ...chain,
    networks,
    preflop: preflop?.stats,
    policy: hybrid.policy,
    hybrid: hybrid.stats,
    exploitRiver: exploit.stats,
  }
}
