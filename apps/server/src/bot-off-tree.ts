import type { PublicDecision } from './bot-public-replay.js'
import { actualChipTarget, exactTurnAction } from './bot-river-carry.js'
import { addRiverAction, type Player, type RiverNode, type RiverSpot } from './bot-river-solver.js'

export interface OffTreeStats {
  events: number
  resolves: number
  failures: Record<string, number>
  ms: number
  maxMs: number
}

export const offTreeStats = (): OffTreeStats => ({
  events: 0,
  resolves: 0,
  failures: {},
  ms: 0,
  maxMs: 0,
})

export interface OffTreeState<T> {
  /** Always solves at the original street root with its frozen ranges/bounds. */
  readonly solve: (tree: RiverNode, fixedStrategies: ReadonlyMap<string, Float64Array>) => T
  readonly failures: Map<string, string>
}

interface Solved {
  readonly strategy: ReadonlyMap<string, Float64Array>
  readonly spot: RiverSpot
  readonly tree: RiverNode
  readonly players: readonly [string, string]
}

/** Replay exact chips; an opponent deviation widens the game before following it. */
export function followWithResolving<T extends Solved & { readonly offTree?: OffTreeState<T> }>(
  initial: T,
  decisions: readonly PublicDecision[],
  self: Player,
  stats: OffTreeStats,
  replace: (solution: T) => void,
): { readonly solved: T; readonly node: RiverNode } | string {
  let solved = initial
  let node = solved.tree
  const fixedStrategies = new Map<string, Float64Array>()
  for (let d = 0; d < decisions.length; d++) {
    const decision = decisions[d] as PublicDecision
    if (node.kind !== 'action') return 'off tree: terminal prefix'
    if (solved.players[node.player] !== decision.observation.actor.playerId)
      return 'off tree: actor mismatch'
    const action = exactTurnAction(node, decision, solved.spot, true)
    if (action === undefined) {
      if (node.player === self) return 'off tree: own size unsupported'
      const state = solved.offTree
      const token = `${node.history}:${JSON.stringify(decision.taken.action)}`
      const previous = state?.failures.get(token)
      if (previous !== undefined) return previous
      stats.events++
      const started = performance.now()
      try {
        if (state === undefined) throw new Error('missing root bounds')
        const target = actualChipTarget(decision, solved.spot, true)
        const tree = addRiverAction(solved.spot, solved.tree, node.history, target)
        const next = state.solve(tree, fixedStrategies)
        // Verify the actual branch survived the solve before replacing the carry record.
        let actual = next.tree
        for (const entry of decisions.slice(0, d + 1)) {
          if (actual.kind !== 'action') throw new Error('resolved prefix is terminal')
          const label = exactTurnAction(actual, entry, next.spot, true)
          if (label === undefined) throw new Error('resolved tree dropped actual action')
          actual = actual.children[actual.actions.indexOf(label)] as RiverNode
        }
        solved = next
        node = actual
        replace(next)
        stats.resolves++
        continue
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error)
        stats.failures[why] = (stats.failures[why] ?? 0) + 1
        const reason = `off tree resolve: ${why}`
        state?.failures.set(token, reason)
        return reason
      } finally {
        const elapsed = performance.now() - started
        stats.ms += elapsed
        stats.maxMs = Math.max(stats.maxMs, elapsed)
      }
    }
    if (node.player === self) {
      const table = solved.strategy.get(node.history)
      if (table === undefined) return 'off tree: missing played strategy'
      fixedStrategies.set(node.history, table)
    }
    node = node.children[node.actions.indexOf(action)] as RiverNode
  }
  return { solved, node }
}
