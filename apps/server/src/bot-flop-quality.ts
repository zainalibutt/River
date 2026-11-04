import { flopEndValues } from './bot-flop-end-data.js'
import { flopShowdown } from './bot-flop-solver.js'
import {
  compatibleMasses,
  type Hands,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  type ShowdownValues,
} from './bot-river-solver.js'
import { holdingIndices } from './bot-turn-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'

/**
 * Lane B's flop decision check: how much of the pot a flop solve's decisions
 * give up, judged by what the flop network is taught rather than by the network
 * itself. A reference flop solve fixes how the betting is reached. Every place
 * its betting closes with chips behind is then valued once by the teacher: the
 * turn solved over the turn cards with the turn-end network, at the ranges the
 * reference reaches it with (`flopEndValues`). Each decision of any candidate
 * is scored against those values, holding by holding, with `actionValues` and
 * `decisionLoss` from the turn check. Values at a closed node are held at the
 * reference's ranges, so a candidate's deviation is judged as a one-step change.
 */

/** Each closed node with chips behind, by its chips in, with both players' reach under `solution`. */
function closedReaches(
  solution: RiverSolution,
  hands: readonly [Hands, Hands],
): Map<string, readonly [Float64Array, Float64Array]> {
  const out = new Map<string, readonly [Float64Array, Float64Array]>()
  const walk = (node: RiverNode, reach: readonly [Float64Array, Float64Array]) => {
    if (node.kind === 'showdown') {
      const behind = solution.spot.stack - Math.max(node.paid[0], node.paid[1])
      if (behind > 0) out.set(`${node.paid[0]},${node.paid[1]}`, reach)
      return
    }
    if (node.kind !== 'action') return
    const width = node.actions.length
    const mix =
      solution.strategy.get(node.history) ??
      new Float64Array(hands[node.player].combos.length * width).fill(1 / width)
    node.children.forEach((child, action) => {
      const next = [reach[0], reach[1]] as [Float64Array, Float64Array]
      next[node.player] = Float64Array.from(
        reach[node.player],
        (r, h) => r * (mix[h * width + action] as number),
      )
      walk(child, next)
    })
  }
  walk(solution.tree, [Float64Array.from(hands[0].weights), Float64Array.from(hands[1].weights)])
  return out
}

/**
 * The teacher's values at every closed node of `reference`, in pots by
 * `comboIndex52`. A holding the reference never brings there keeps a sliver
 * of weight, so it still gets a value: a candidate may bring it.
 */
export type TeacherLeaf = (leaf: RiverSpot, key: string) => readonly [Float64Array, Float64Array]

export function turnSolvedTeacher(
  turnNetwork: RiverValueNetwork,
  turnCards: number,
  seed: string,
): TeacherLeaf {
  return (leaf, key) => flopEndValues(leaf, turnNetwork, turnCards, `${seed}:${key}`)
}

export function teacherShowdown(
  reference: RiverSolution,
  hands: readonly [Hands, Hands],
  teacher: TeacherLeaf,
  allInNetwork: RiverValueNetwork,
): ShowdownValues {
  const { spot } = reference
  const leaves = new Map<string, readonly [Float64Array, Float64Array]>()
  for (const [key, reach] of closedReaches(reference, hands)) {
    const [paid0, paid1] = key.split(',').map(Number) as [number, number]
    const ranges = ([0, 1] as const).map((player) => {
      const top = reach[player].reduce((most, r) => Math.max(most, r), 0)
      return hands[player].combos.map((combo, h) => ({
        hole: combo.hole,
        weight: Math.max(reach[player][h] as number, top * 1e-6, 1e-12),
      }))
    }) as unknown as RiverSpot['ranges']
    const leaf: RiverSpot = {
      ...spot,
      pot: spot.pot + paid0 + paid1,
      stack: spot.stack - Math.max(paid0, paid1),
      ranges,
    }
    leaves.set(key, teacher(leaf, key))
  }
  // All-ins are settled exactly over the runouts, as the flop solver settles them.
  const allIn = flopShowdown(spot, allInNetwork)
  const indices = holdingIndices(hands)
  return (node, traverser, held, self, opponent, out) => {
    const behind = spot.stack - Math.max(node.paid[0], node.paid[1])
    const values = leaves.get(`${node.paid[0]},${node.paid[1]}`)
    if (behind <= 0 || values === undefined) {
      allIn(node, traverser, held, self, opponent, out)
      return
    }
    const other = traverser === 0 ? 1 : 0
    const total = spot.pot + node.paid[0] + node.paid[1]
    const mine = node.paid[traverser]
    const met = compatibleMasses(held[traverser], held[other], opponent)
    const own = indices[traverser]
    for (let h = 0; h < own.length; h += 1) {
      const value = values[traverser][own[h] as number] as number
      out[h] = (met[h] as number) * (value * total - mine)
    }
  }
}
