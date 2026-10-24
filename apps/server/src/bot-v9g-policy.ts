import { pokerGuardPolicy } from './bot-poker-guard.js'
import { tablePreflopPolicy } from './bot-preflop-tables.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import type { SafeExploitConfig } from './bot-safe-exploitation.js'
import { predictableHybridPolicy, solvedFlopPolicy } from './bot-turn-policy.js'
import {
  loadValueNetwork,
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
  readonly safeExploitConfig?: Partial<SafeExploitConfig>
}

/** Shared table/shark construction for the carried chain and its opt-in variants. */
export function v9gPolicy({
  offTree,
  boundedReads = false,
  baselineCaps,
  hybridThreshold,
  preflopTables = false,
  safeExploitV2 = false,
  safeExploitConfig,
}: V9gOptions = {}) {
  const flop = process.env.RIVER_FLOP_NETWORK
  if (!flop) throw new Error('v9g needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
  const preflop = preflopTables ? tablePreflopPolicy(pokerGuardPolicy) : undefined
  const chain = solvedFlopPolicy(turnNetworkFromEnvironment(), loadValueNetwork(flop), {
    carry: 'both',
    turnStartNetwork: turnStartNetworkFromEnvironment(),
    riverNetwork: riverNetworkFromEnvironment(),
    scheme: 'dcfr',
    iterations: 40,
    boundedReads,
    ...(safeExploitV2 ? { safeExploitV2, safeExploitConfig } : {}),
    ...(preflop === undefined ? {} : { preflop }),
    ...(offTree === undefined ? {} : { offTree }),
    ...(baselineCaps === undefined ? {} : { baselineCaps }),
  })
  if (hybridThreshold === undefined)
    return { ...chain, preflop: preflop?.stats, hybrid: undefined, exploitRiver: undefined }
  const exploit = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
  const hybrid = predictableHybridPolicy(chain.policy, exploit.policy, hybridThreshold)
  return {
    ...chain,
    preflop: preflop?.stats,
    policy: hybrid.policy,
    hybrid: hybrid.stats,
    exploitRiver: exploit.stats,
  }
}
