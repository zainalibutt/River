import type { TurnStartLeafOptions } from './bot-flop-turn-leaves.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { tablePreflopPolicy } from './bot-preflop-tables.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import type { SafeExploitConfig } from './bot-safe-exploitation.js'
import type { SafeTurnExploitConfig } from './bot-safe-turn-exploitation.js'
import { explicitTurnSolveLeaf } from './bot-turn-explicit-leaf.js'
import { predictableHybridPolicy, solvedFlopPolicy, TURN_POLICY_TUNING } from './bot-turn-policy.js'
import {
  loadTurnResidualNetwork,
  type TurnResidualNetwork,
  turnResidualLeaf,
} from './bot-turn-residual.js'
import {
  loadValueNetwork,
  type RiverValueNetwork,
  riverNetworkFromEnvironment,
  turnNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'

export interface V9gOptions {
  /** Offline replay opt-in; scales flop/turn solves, including off-tree re-solves. */
  readonly resolveIterationMultiplier?: number
  readonly offTree?: 'resolve'
  readonly boundedReads?: boolean
  readonly baselineCaps?: boolean
  readonly hybridThreshold?: number
  readonly preflopTables?: boolean
  readonly safeExploitV2?: boolean
  readonly safeTurnExploit?: boolean
  readonly safeTurnExploitConfig?: Partial<SafeTurnExploitConfig>
  readonly safeExploitConfig?: Partial<SafeExploitConfig>
  /** Default absent: production batching and weights are unchanged. */
  readonly turnStartLeaf?: TurnStartLeafOptions
}

/** Only immutable inference weights are shared; each construction owns its solves. */
export interface V9gNetworks {
  readonly turn: RiverValueNetwork
  readonly flop: RiverValueNetwork
  readonly turnStart: RiverValueNetwork
  readonly river: RiverValueNetwork
  readonly turnResidual?: TurnResidualNetwork
}

/** Strictly increasing, unique pot fractions; unset preserves the production tree. */
export function flopBetSizesFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.RIVER_FLOP_BET_SIZES
  if (raw === undefined) return undefined
  const sizes = raw.split(',').map((part) => (part.trim() === '' ? Number.NaN : Number(part)))
  if (
    sizes.length > 5 ||
    sizes.some(
      (size, i) =>
        !Number.isFinite(size) || size <= 0 || (i > 0 && size <= (sizes[i - 1] as number)),
    )
  )
    throw new Error(
      'RIVER_FLOP_BET_SIZES must contain 1 to 5 finite positive, sorted, unique pot fractions',
    )
  return sizes
}

/** Keep the export stem verbatim; the loader owns the bucket/head suffixes. */
export function turnResidualOptionsFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const stem = env.RIVER_TURN_RESIDUAL
  const refresh = env.RIVER_TURN_RESIDUAL_REFRESH ?? 'never'
  if (
    refresh !== 'never' &&
    (!/^[0-9]+$/.test(refresh) || !Number.isSafeInteger(Number(refresh)) || Number(refresh) < 1)
  )
    throw new Error('RIVER_TURN_RESIDUAL_REFRESH must be never or a positive integer')
  if (stem === undefined) return undefined
  if (stem.length === 0 || stem.trim() !== stem)
    throw new Error('RIVER_TURN_RESIDUAL must be a nonempty export stem')
  return { stem, refreshIterations: refresh === 'never' ? ('never' as const) : Number(refresh) }
}

export function turnExplicitOptionsFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const refresh = env.RIVER_TURN_EXPLICIT_LEAF
  if (refresh === undefined) return undefined
  if (env.RIVER_TURN_RESIDUAL !== undefined)
    throw new Error('RIVER_TURN_EXPLICIT_LEAF and RIVER_TURN_RESIDUAL are mutually exclusive')
  if (
    refresh !== 'never' &&
    (!/^[0-9]+$/.test(refresh) || !Number.isSafeInteger(Number(refresh)) || Number(refresh) < 1)
  )
    throw new Error('RIVER_TURN_EXPLICIT_LEAF must be never or a positive integer')
  return { refreshIterations: refresh === 'never' ? ('never' as const) : Number(refresh) }
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
    turnStartLeaf,
    resolveIterationMultiplier = 1,
  }: V9gOptions = {},
  sharedNetworks?: V9gNetworks,
) {
  if (
    !Number.isSafeInteger(resolveIterationMultiplier) ||
    resolveIterationMultiplier < 1 ||
    !Number.isSafeInteger(40 * resolveIterationMultiplier)
  )
    throw new Error('resolveIterationMultiplier must be a positive safe integer')
  const explicit = turnExplicitOptionsFromEnvironment()
  const flopBetSizes = flopBetSizesFromEnvironment()
  const residual = turnResidualOptionsFromEnvironment()
  const flop = process.env.RIVER_FLOP_NETWORK
  if (!flop) throw new Error('v9g needs RIVER_FLOP_NETWORK: the flop network export, without .bin')
  const preflop = preflopTables ? tablePreflopPolicy(pokerGuardPolicy) : undefined
  const loadedNetworks = sharedNetworks ?? {
    turn: turnNetworkFromEnvironment(),
    flop: loadValueNetwork(flop),
    turnStart: turnStartNetworkFromEnvironment(),
    river: riverNetworkFromEnvironment(),
  }
  const networks =
    residual !== undefined && loadedNetworks.turnResidual === undefined
      ? { ...loadedNetworks, turnResidual: loadTurnResidualNetwork(residual.stem) }
      : loadedNetworks
  const leaf =
    turnStartLeaf ??
    (explicit !== undefined
      ? {
          network: explicitTurnSolveLeaf(networks.turnStart, networks.river, {
            ...explicit,
            iterations: 40 * resolveIterationMultiplier,
            betSizes: TURN_POLICY_TUNING.betSizes,
            maxRaises: TURN_POLICY_TUNING.maxRaises,
            allIn: true,
            scheme: 'dcfr',
          }),
        }
      : residual === undefined || networks.turnResidual === undefined
        ? undefined
        : {
            network: turnResidualLeaf(networks.turnResidual, {
              refreshIterations: residual.refreshIterations,
            }),
          })
  const chain = solvedFlopPolicy(networks.turn, networks.flop, {
    carry: 'both',
    turnStartNetwork: networks.turnStart,
    riverNetwork: networks.river,
    scheme: 'dcfr',
    iterations: 40 * resolveIterationMultiplier,
    ...(flopBetSizes === undefined ? {} : { flopBetSizes }),
    ...(leaf === undefined ? {} : { turnStartLeaf: leaf }),
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
