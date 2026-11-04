import type { AivatRangeState } from './bot-aivat.js'
import type { RiverNode, RiverSpot } from './bot-river-solver.js'

/** Snapshot the solver's tracked root ranges, conditioned on this public path.
 * Only evaluated inside an explicitly requested capture. No policy/RNG calls. */
export function aivatSolverState(
  spot: RiverSpot,
  root: RiverNode,
  strategy: ReadonlyMap<string, Float64Array>,
  target: Extract<RiverNode, { kind: 'action' }>,
  actorPlayer: 0 | 1,
): AivatRangeState {
  const blocked = new Set(spot.board.map(cardKey))
  const ranges = spot.ranges.map((range) =>
    range
      .filter(
        (combo) => combo.weight > 0 && combo.hole.every((card) => !blocked.has(cardKey(card))),
      )
      .map((combo) => ({ hole: [...combo.hole] as typeof combo.hole, weight: combo.weight })),
  ) as [(typeof spot.ranges)[0][number][], (typeof spot.ranges)[1][number][]]
  type ActionNode = Extract<RiverNode, { kind: 'action' }>
  const path: { node: ActionNode; branch: number }[] = []
  const find = (node: RiverNode): boolean => {
    if (node === target) return true
    if (node.kind !== 'action') return false
    for (let branch = 0; branch < node.children.length; branch++) {
      path.push({ node, branch })
      if (find(node.children[branch] as RiverNode)) return true
      path.pop()
    }
    return false
  }
  if (!find(root)) throw new Error('AIVAT target outside solver tree')
  for (const { node, branch } of path) {
    const table = strategy.get(node.history)
    if (branch < 0 || !table) throw new Error('AIVAT public path unavailable')
    const width = node.actions.length
    if (table.length !== ranges[node.player].length * width)
      throw new Error('AIVAT range/strategy alignment mismatch')
    ranges[node.player] = ranges[node.player].map((combo, h) => {
      // Match the cumulative sampler, including clipping and the final remainder.
      let previous = 0
      for (let a = 0; a < branch; a++) previous += table[h * width + a] as number
      const boundary = branch === width - 1 ? 1 : previous + (table[h * width + branch] as number)
      const probability = Math.min(1, boundary) - Math.min(1, previous)
      return { ...combo, weight: combo.weight * probability }
    })
  }
  return { ranges, actorPlayer }
}

import { cardKey } from '@river/engine'
