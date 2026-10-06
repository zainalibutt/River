import {
  compatibleMasses,
  type Hands,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  type ShowdownValues,
  terminal,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { HOLDING_CARDS, turnRivers } from './bot-turn-end-data.js'
import { allInShowdown } from './bot-turn-solver.js'
import {
  bucketInputs,
  bucketsFromRanks,
  forward,
  type RiverValueNetwork,
} from './bot-value-network.js'

/**
 * v9's offline decision check (docs/bots.md): how much of the pot a turn
 * solve's decisions give up, measured without playing a hand. A reference
 * solve values the turn's closed betting the way the turn-end network's own
 * answers are made, by the river network on every river card that can come;
 * each decision of a candidate solve is then scored against the reference's
 * value for each action, holding by holding.
 */

/** Every prepared holding's place among the 1,326, by player. */
function holdingIndices(hands: readonly [Hands, Hands]): readonly [Int32Array, Int32Array] {
  const of = (held: Hands) =>
    Int32Array.from(held.combos, (_, h) =>
      comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number),
    )
  return [of(hands[0]), of(hands[1])]
}

/**
 * Closed turn betting valued as the turn-end network's teacher values it: by
 * the river network on every river card, each holding's value there weighted
 * by the opponent reach it can meet on that river, and all-ins exactly. One
 * network call per river per valuation, so slow, but on the turn truth set
 * these answers are 1.5% of the pot off where the turn-end network is 5.7%.
 */
export function riverAveragedShowdown(spot: RiverSpot, river: RiverValueNetwork): ShowdownValues {
  const rivers = turnRivers(spot.board)
  const layouts = rivers.rivers.map((card) => bucketsFromRanks(card.ranks, river.buckets))
  const reach = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const sums = new Float64Array(COMBOS)
  const weights = new Float64Array(COMBOS)
  const perCard = new Float64Array(52)
  let indices: readonly [Int32Array, Int32Array] | undefined
  let allIn: ReturnType<typeof allInShowdown> | undefined
  return (node, traverser, hands, self, opponent, out) => {
    const other = traverser === 0 ? 1 : 0
    const total = spot.pot + node.paid[0] + node.paid[1]
    const mine = node.paid[traverser]
    const behind = spot.stack - Math.max(node.paid[0], node.paid[1])
    if (behind <= 0) {
      allIn ??= allInShowdown(rivers, hands)
      allIn(traverser, opponent, total, mine, out)
      return
    }
    indices ??= holdingIndices(hands)
    const own = indices[traverser]
    reach[traverser].fill(0)
    reach[other].fill(0)
    // As in the turn solver: a range that cannot reach here is valued as if it held its whole range.
    let ownTotal = 0
    for (let h = 0; h < self.length; h += 1) ownTotal += self[h] as number
    const ownRange = ownTotal > 0 ? self : hands[traverser].weights
    for (let h = 0; h < own.length; h += 1)
      reach[traverser][own[h] as number] = ownRange[h] as number
    indices[other].forEach((index, o) => {
      reach[other][index] = opponent[o] as number
    })
    const theirs = reach[other]
    sums.fill(0)
    weights.fill(0)
    rivers.rivers.forEach((_, k) => {
      const layout = layouts[k] as ReturnType<typeof bucketsFromRanks>
      const outputs = forward(river, bucketInputs(layout, [reach[0], reach[1]], behind, total))
      perCard.fill(0)
      let left = 0
      for (let o = 0; o < COMBOS; o += 1) {
        const weight = theirs[o] as number
        if (weight === 0 || (layout.bucketOf[o] as number) < 0) continue
        const [a, b] = HOLDING_CARDS[o] as readonly [number, number]
        left += weight
        perCard[a] = (perCard[a] as number) + weight
        perCard[b] = (perCard[b] as number) + weight
      }
      for (let h = 0; h < own.length; h += 1) {
        const index = own[h] as number
        const bucket = layout.bucketOf[index] as number
        if (bucket < 0) continue
        const [a, b] = HOLDING_CARDS[index] as readonly [number, number]
        const mass =
          left - (perCard[a] as number) - (perCard[b] as number) + (theirs[index] as number)
        sums[index] =
          (sums[index] as number) + mass * (outputs[traverser * river.buckets + bucket] as number)
        weights[index] = (weights[index] as number) + mass
      }
    })
    const met = compatibleMasses(hands[traverser], hands[other], opponent)
    for (let h = 0; h < own.length; h += 1) {
      const index = own[h] as number
      const mass = weights[index] as number
      const value = mass > 0 ? (sums[index] as number) / mass : 0
      out[h] = (met[h] as number) * (value * total - mine)
    }
  }
}

function scaled(reach: Float64Array, mix: Float64Array, width: number, action: number) {
  return Float64Array.from(reach, (r, index) => r * (mix[index * width + action] as number))
}

/**
 * The traverser's counterfactual value for each of its holdings at `node`,
 * both players following `solution` from there: the chips it expects, summed
 * over the opponent holdings it can meet and weighted by their reach.
 */
export function valuesBelow(
  solution: RiverSolution,
  hands: readonly [Hands, Hands],
  showdown: ShowdownValues,
  node: RiverNode,
  traverser: 0 | 1,
  self: Float64Array,
  opponent: Float64Array,
): Float64Array {
  if (node.kind === 'fold') return terminal(node, traverser, hands, opponent, solution.spot.pot)
  if (node.kind === 'showdown') {
    const out = new Float64Array(hands[traverser].combos.length)
    showdown(node, traverser, hands, self, opponent, out)
    return out
  }
  const width = node.actions.length
  const mix =
    solution.strategy.get(node.history) ??
    new Float64Array(hands[node.player].combos.length * width).fill(1 / width)
  if (node.player === traverser) {
    const values = node.children.map((child, action) =>
      valuesBelow(
        solution,
        hands,
        showdown,
        child,
        traverser,
        scaled(self, mix, width, action),
        opponent,
      ),
    )
    return Float64Array.from(self, (_, h) =>
      values.reduce(
        (sum, value, action) => sum + (mix[h * width + action] as number) * (value[h] as number),
        0,
      ),
    )
  }
  const sum = new Float64Array(hands[traverser].combos.length)
  node.children.forEach((child, action) => {
    const part = valuesBelow(
      solution,
      hands,
      showdown,
      child,
      traverser,
      self,
      scaled(opponent, mix, width, action),
    )
    for (let h = 0; h < sum.length; h += 1) sum[h] = (sum[h] as number) + (part[h] as number)
  })
  return sum
}

export interface ActionValues {
  readonly history: string
  readonly player: 0 | 1
  /** Per action, each holding's value in pots for every unit of opponent reach it can meet. */
  readonly values: readonly Float64Array[]
  /** The player's reach on each holding here under the reference. */
  readonly reach: Float64Array
}

/**
 * At the decision `history`, the acting player's value for each action,
 * holding by holding, with both players following `reference` everywhere
 * else: the yardstick a candidate's choices there are scored against.
 */
export function actionValues(
  reference: RiverSolution,
  hands: readonly [Hands, Hands],
  showdown: ShowdownValues,
  history: string,
): ActionValues | undefined {
  const reach = [Float64Array.from(hands[0].weights), Float64Array.from(hands[1].weights)]
  let node: RiverNode = reference.tree
  while (node.kind === 'action' && node.history !== history) {
    const width: number = node.actions.length
    // The child on the way is the one whose history is the longest start of the target's.
    let next: RiverNode | undefined
    for (const child of node.children) {
      if (child.kind !== 'action' || !history.startsWith(child.history)) continue
      if (
        next === undefined ||
        (next.kind === 'action' && child.history.length > next.history.length)
      ) {
        next = child
      }
    }
    if (next === undefined) return undefined
    const action = node.children.indexOf(next)
    const mix = reference.strategy.get(node.history)
    if (mix !== undefined) {
      reach[node.player] = scaled(reach[node.player] as Float64Array, mix, width, action)
    }
    node = next
  }
  if (node.kind !== 'action') return undefined
  const player = node.player
  const other = player === 0 ? 1 : 0
  const width = node.actions.length
  const mix =
    reference.strategy.get(node.history) ??
    new Float64Array(hands[player].combos.length * width).fill(1 / width)
  const own = reach[player] as Float64Array
  const theirs = reach[other] as Float64Array
  const met = compatibleMasses(hands[player], hands[other], theirs)
  const values = node.children.map((child, action) => {
    const summed = valuesBelow(
      reference,
      hands,
      showdown,
      child,
      player,
      scaled(own, mix, width, action),
      theirs,
    )
    return Float64Array.from(summed, (value, h) => {
      const mass = met[h] as number
      return mass > 0 ? value / mass / reference.spot.pot : 0
    })
  })
  return { history, player, values, reach: own }
}

/**
 * How much of the pot a strategy gives up at a decision, against the
 * reference's action values: for each holding, the best action's value less
 * the value of the strategy's mix, averaged over the holdings by the player's
 * reach there under the reference.
 */
export function decisionLoss(at: ActionValues, mix: Float64Array): number {
  const width = at.values.length
  let lost = 0
  let reached = 0
  at.reach.forEach((weight, h) => {
    if (weight <= 0) return
    let best = Number.NEGATIVE_INFINITY
    let played = 0
    at.values.forEach((value, action) => {
      const v = value[h] as number
      best = Math.max(best, v)
      played += (mix[h * width + action] as number) * v
    })
    lost += weight * (best - played)
    reached += weight
  })
  return reached > 0 ? lost / reached : 0
}
