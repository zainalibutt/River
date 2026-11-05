import { parentPort, workerData } from 'node:worker_threads'
import { mulberry32 } from '@river/engine'
import type { LiveSafeVariant } from './bot-live-safe.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { releasePolicyHand } from './bot-policy-hand.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { setSolveDeadline, takeShortenedSolves } from './bot-river-solver.js'
import { actionFor } from './bot-service.js'
import type { ThinkRequest } from './bot-thinker.js'
import { V9GP_POLICY_OPTIONS, type V9gNetworks, v9gPolicy } from './bot-v9g-policy.js'
import { valueNetworkBackend } from './bot-value-simd.js'

// Pool workers are the CPU participants. Never create nested inference workers.
process.env.RIVER_VALUE_THREADS = '1'
if (process.env.RIVER_VALUE_BACKEND !== 'ts') delete process.env.RIVER_VALUE_BACKEND
const variant = workerData.variant as LiveSafeVariant
const create = (networks?: V9gNetworks) =>
  v9gPolicy(variant === 'v9go' ? { offTree: 'resolve' } : V9GP_POLICY_OPTIONS[variant], networks)
const started = performance.now()
let networks: V9gNetworks | undefined
let modelError: string | undefined
let backends: string[] = []
try {
  networks = create().networks
  backends = Object.values(networks).map(valueNetworkBackend)
} catch (error) {
  modelError = String(error)
}
const chains = new Map<string, { roomId: string; hand: number; chain: ReturnType<typeof create> }>()
const baseline = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
const diagnostics = () => {
  let entries = 0
  let bytes = 0
  for (const { chain } of chains.values()) {
    for (const cache of Object.values(chain.caches())) {
      entries += cache?.entries ?? 0
      bytes += cache?.bytes ?? 0
    }
  }
  return { chains: chains.size, entries, bytes }
}
parentPort?.postMessage({
  type: 'ready',
  coldStartMs: performance.now() - started,
  modelError,
  backends,
})
parentPort?.on('message', (message) => {
  if (message.type === 'release') {
    for (const [key, entry] of chains) {
      if (entry.roomId === message.roomId && entry.hand === message.handNumber) {
        releasePolicyHand(entry.chain.policy, entry.roomId, entry.hand)
        chains.delete(key)
      }
    }
    releasePolicyHand(baseline.policy, message.roomId, message.handNumber)
    parentPort?.postMessage({ type: 'released', ...diagnostics() })
    return
  }
  const received = performance.now()
  const { request, id, safe, stopAfterMs } = message as {
    request: ThinkRequest
    id: number
    safe: boolean
    stopAfterMs?: number
  }
  const act = (policy: typeof baseline.policy) => {
    let invalid = false
    const action = actionFor(
      request.view,
      request.playerId,
      request.personality,
      mulberry32(request.seed),
      {
        ...request.options,
        policy,
        trace: (trace) => {
          invalid = trace.fallbackReason !== null
        },
      },
    )
    return invalid ? null : action
  }
  let fallback = null
  try {
    fallback = act(baseline.policy)
  } catch {
    // The controller already has the guard's legal action if even v8z fails.
  }
  parentPort?.postMessage({ type: 'baseline', id, action: fallback })
  if (!safe || networks === undefined) {
    parentPort?.postMessage({
      type: 'result',
      id,
      action: fallback,
      reason: safe ? 'model_error' : fallback === null ? 'baseline_error' : null,
      ...diagnostics(),
    })
    return
  }
  try {
    const roomId = request.options.roomId ?? 'local'
    const hand = request.view.handNumber
    const key = JSON.stringify([roomId, hand, request.playerId])
    let entry = chains.get(key)
    if (entry === undefined) {
      entry = { roomId, hand, chain: create(networks) }
      chains.set(key, entry)
    }
    // Do not let actionFor swallow a solver exception into its rule fallback.
    let solverError = false
    const policy = {
      ...entry.chain.policy,
      decide: (context: Parameters<typeof entry.chain.policy.decide>[0]) => {
        try {
          return entry.chain.policy.decide(context)
        } catch (error) {
          solverError = true
          throw error
        }
      },
    }
    const counts = () =>
      [entry.chain.stats, entry.chain.turn, entry.chain.river].flatMap((stats, street) =>
        Object.entries(stats.fallbacks).map(
          ([reason, count]) => [`${street}:${reason}`, count] as const,
        ),
      )
    const before = new Map(counts())
    // 2x keeps adding iterations only while there is time, and never stops a
    // solve below its 1x count. Other variants play exactly as they did.
    takeShortenedSolves()
    if (variant === 'v9gpw2' && stopAfterMs !== undefined)
      setSolveDeadline(received + stopAfterMs, 0.5)
    let action: ReturnType<typeof act>
    try {
      action = act(policy)
    } finally {
      setSolveDeadline(undefined)
    }
    const shortened = takeShortenedSolves()
    const internalFallback = counts().find(
      ([reason, count]) => count > (before.get(reason) ?? 0),
    )?.[0]
    const reason = solverError
      ? 'solver_error'
      : action === null
        ? 'invalid_solver_action'
        : internalFallback === undefined
          ? null
          : `chain_fallback:${internalFallback}`
    parentPort?.postMessage({
      type: 'result',
      id,
      action: reason === null ? action : fallback,
      reason,
      shortened,
      ...diagnostics(),
    })
  } catch {
    parentPort?.postMessage({
      type: 'result',
      id,
      action: fallback,
      reason: 'solver_error',
      ...diagnostics(),
    })
  }
})
