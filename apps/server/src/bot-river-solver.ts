import { type Card, cardKey, handScore } from '@river/engine'

/**
 * Solves a heads-up river: both ranges, the board, the pot and the stacks are
 * fixed, and the solver finds how often every hand in each range should check,
 * bet each size, call, raise or fold. It runs CFR+ over whole ranges at once,
 * so each decision updates every holding together, and settles showdowns in
 * one pass over hands sorted by strength with cards that clash taken out.
 */
export interface RangeCombo {
  readonly hole: readonly [Card, Card]
  readonly weight: number
}

export interface RiverSpot {
  readonly board: readonly Card[]
  /** Chips in the pot before any river betting. */
  readonly pot: number
  /** Chips each player has behind. */
  readonly stack: number
  /** Player 0 acts first, out of position; player 1 is in position. */
  readonly ranges: readonly [readonly RangeCombo[], readonly RangeCombo[]]
  /** Bet and raise sizes as fractions of the pot at the time. */
  readonly betSizes: readonly number[]
  readonly allIn: boolean
  /** Raises allowed after the first bet. */
  readonly maxRaises: number
}

export type Player = 0 | 1

/**
 * A known way one player plays the river, for exploiting them. With
 * probability `weight` they follow `strategy`; otherwise they play as the
 * solver lets them, which is best for them. The other player's solution is
 * then the best counter to that mixture that is still hard to exploit, known
 * as a restricted Nash response. `strategy` gives the modelled player's
 * probabilities at one of their decisions, one row of the decision's actions
 * per holding, flattened.
 */
export interface RiverOpponentModel {
  readonly player: 0 | 1
  readonly weight: number
  readonly strategy: (node: Extract<RiverNode, { kind: 'action' }>, hands: Hands) => Float64Array
}

export type RiverNode =
  | { readonly kind: 'fold'; readonly folder: Player; readonly paid: readonly [number, number] }
  | { readonly kind: 'showdown'; readonly paid: readonly [number, number] }
  | {
      readonly kind: 'action'
      readonly player: Player
      readonly history: string
      /** Chips each player has put in on the river before this decision. */
      readonly paid: readonly [number, number]
      readonly actions: readonly string[]
      readonly children: readonly RiverNode[]
    }

export interface Hands {
  readonly combos: readonly RangeCombo[]
  readonly weights: Float64Array
  readonly strength: Float64Array
  readonly cards: Int32Array
  /** Indices sorted by strength, weakest first. */
  readonly order: Int32Array
  readonly byPair: ReadonlyMap<number, number>
}

export interface RiverSolution {
  readonly tree: RiverNode
  /**
   * Average strategy per decision history: a row of action probabilities for
   * each combo of the acting player, the rows back to back in one array (combo
   * `h`, action `a` at `h * actions + a`), laid out as an opponent model's is.
   */
  readonly strategy: ReadonlyMap<string, Float64Array>
  readonly spot: RiverSpot
}

/** The betting tree for a spot: checks, bets and raises by the spot's sizes, capped. */
export function riverTree(spot: RiverSpot): RiverNode {
  const build = (
    player: Player,
    paid: [number, number],
    raises: number,
    history: string,
    facing: boolean,
  ): RiverNode => {
    const other: Player = player === 0 ? 1 : 0
    const actions: string[] = []
    const children: RiverNode[] = []
    const add = (action: string, child: RiverNode) => {
      actions.push(action)
      children.push(child)
    }
    const toCall = paid[other] - paid[player]
    const left = spot.stack - paid[player]
    if (facing) {
      add('f', { kind: 'fold', folder: player, paid: [paid[0], paid[1]] })
      const called: [number, number] = [paid[0], paid[1]]
      called[player] = paid[other]
      add('c', { kind: 'showdown', paid: called })
    } else if (history.endsWith('k') && history.length > 0) {
      add('k', { kind: 'showdown', paid: [paid[0], paid[1]] })
    } else {
      add('k', build(other, [paid[0], paid[1]], raises, `${history}k`, false))
    }
    const canRaise = !facing || raises < spot.maxRaises
    if (canRaise && left > toCall) {
      const potAfterCall = spot.pot + paid[0] + paid[1] + toCall
      const targets = new Set<number>()
      for (const size of spot.betSizes) {
        const extra = Math.round(toCall + size * potAfterCall)
        if (extra < left) targets.add(extra)
      }
      if (spot.allIn) targets.add(left)
      for (const extra of [...targets].sort((a, b) => a - b)) {
        const next: [number, number] = [paid[0], paid[1]]
        next[player] += extra
        const label = extra === left ? 'a' : `b${next[player]}`
        add(label, build(other, next, facing ? raises + 1 : raises, `${history}${label}`, true))
      }
    }
    return { kind: 'action', player, history, paid: [paid[0], paid[1]], actions, children }
  }
  return build(0, [0, 0], 0, '', false)
}

/**
 * A decision in the tree with the buffers the solver reuses on every visit:
 * regrets, strategy sums and the current strategy, one row per holding of the
 * acting player; the reach passed to each child; and the values handed back
 * for each traverser.
 */
type Compiled =
  | {
      readonly kind: 'terminal'
      readonly node: Exclude<RiverNode, { kind: 'action' }>
      readonly out: readonly [Float64Array, Float64Array]
    }
  | {
      readonly kind: 'action'
      readonly history: string
      readonly player: Player
      readonly width: number
      readonly count: number
      readonly regret: Float64Array
      readonly sum: Float64Array
      readonly strategy: Float64Array
      readonly reach: readonly Float64Array[]
      readonly values: Float64Array[]
      readonly out: readonly [Float64Array, Float64Array]
      readonly children: readonly Compiled[]
      /** The modelled player's known strategy here, and the reach its part passes down. */
      readonly fixed: Float64Array | null
      readonly fixedReach: readonly Float64Array[]
    }

function compile(
  node: RiverNode,
  hands: readonly [Hands, Hands],
  model: RiverOpponentModel | undefined,
): Compiled {
  const out = [
    new Float64Array(hands[0].combos.length),
    new Float64Array(hands[1].combos.length),
  ] as const
  if (node.kind !== 'action') return { kind: 'terminal', node, out }
  const width = node.actions.length
  const count = hands[node.player].combos.length
  const modelled = model !== undefined && model.player === node.player
  return {
    kind: 'action',
    history: node.history,
    player: node.player,
    width,
    count,
    regret: new Float64Array(count * width),
    sum: new Float64Array(count * width),
    strategy: new Float64Array(count * width),
    reach: node.actions.map(() => new Float64Array(count)),
    values: new Array<Float64Array>(width),
    out,
    children: node.children.map((child) => compile(child, hands, model)),
    fixed: modelled ? model.strategy(node, hands[node.player]) : null,
    fixedReach: modelled ? node.actions.map(() => new Float64Array(count)) : [],
  }
}

/**
 * What a showdown node is worth when the hand does not end there: on the
 * turn, betting that closes with both players in goes on to the river. Fills
 * `out` with the traverser's counterfactual value for each of its holdings,
 * given both players' reach at the node, as `terminal` does for a river.
 */
export type ShowdownValues = (
  node: Extract<RiverNode, { kind: 'showdown' }>,
  traverser: Player,
  hands: readonly [Hands, Hands],
  self: Float64Array,
  opponent: Float64Array,
  out: Float64Array,
) => void

/**
 * Runs CFR+ on a river spot for `iterations` and returns the average strategy.
 * With a `model`, the other player's strategy is the restricted Nash response
 * to it. With `showdown`, closed betting is valued by it instead of by a
 * showdown on the board, so the same betting can be solved a street earlier.
 */
export function solveRiver(
  spot: RiverSpot,
  iterations: number,
  model?: RiverOpponentModel,
  showdown?: ShowdownValues,
): RiverSolution {
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const tree = riverTree(spot)
  const scratch = scratchFor(hands)
  const root = compile(tree, hands, model)
  const combined = new Float64Array(Math.max(hands[0].combos.length, hands[1].combos.length))
  // `fixed` is the modelled player's reach while they follow the model; it is
  // only carried while the other player is the one learning.
  const walk = (
    node: Compiled,
    traverser: Player,
    self: Float64Array,
    opponent: Float64Array,
    fixed: Float64Array | null,
    weight: number,
  ): Float64Array => {
    const out = node.out[traverser]
    if (node.kind === 'terminal') {
      let reach = opponent
      if (fixed !== null) {
        for (let o = 0; o < opponent.length; o += 1) {
          combined[o] = (opponent[o] as number) + (fixed[o] as number)
        }
        reach = combined
      }
      if (showdown !== undefined && node.node.kind === 'showdown') {
        showdown(node.node, traverser, hands, self, reach, out)
      } else {
        terminalInto(node.node, traverser, hands, reach, spot.pot, scratch, out)
      }
      return out
    }
    const { width, count, regret, strategy, sum, reach, values, children } = node
    for (let h = 0; h < count; h += 1) {
      let total = 0
      for (let action = 0; action < width; action += 1) {
        total += Math.max(0, regret[h * width + action] as number)
      }
      for (let action = 0; action < width; action += 1) {
        strategy[h * width + action] =
          total > 0 ? Math.max(0, regret[h * width + action] as number) / total : 1 / width
      }
    }
    if (node.player === traverser) {
      for (let action = 0; action < width; action += 1) {
        const next = reach[action] as Float64Array
        for (let h = 0; h < count; h += 1) {
          next[h] = (self[h] as number) * (strategy[h * width + action] as number)
        }
        values[action] = walk(
          children[action] as Compiled,
          traverser,
          next,
          opponent,
          fixed,
          weight,
        )
      }
      for (let h = 0; h < count; h += 1) {
        let value = 0
        for (let action = 0; action < width; action += 1) {
          value =
            value +
            (strategy[h * width + action] as number) *
              ((values[action] as Float64Array)[h] as number)
        }
        out[h] = value
      }
      for (let h = 0; h < count; h += 1) {
        for (let action = 0; action < width; action += 1) {
          const at = h * width + action
          regret[at] = Math.max(
            0,
            (regret[at] as number) +
              ((values[action] as Float64Array)[h] as number) -
              (out[h] as number),
          )
          sum[at] = (sum[at] as number) + weight * (self[h] as number) * (strategy[at] as number)
        }
      }
      return out
    }
    out.fill(0)
    for (let action = 0; action < width; action += 1) {
      const next = reach[action] as Float64Array
      for (let o = 0; o < count; o += 1) {
        next[o] = (opponent[o] as number) * (strategy[o * width + action] as number)
      }
      let nextFixed: Float64Array | null = null
      if (fixed !== null && node.fixed !== null) {
        nextFixed = node.fixedReach[action] as Float64Array
        for (let o = 0; o < count; o += 1) {
          nextFixed[o] = (fixed[o] as number) * (node.fixed[o * width + action] as number)
        }
      }
      const part = walk(children[action] as Compiled, traverser, self, next, nextFixed, weight)
      for (let h = 0; h < out.length; h += 1) out[h] = (out[h] as number) + (part[h] as number)
    }
    return out
  }
  // While the unmodelled player learns, the modelled player's reach splits
  // into the part that follows the model and the part that plays freely.
  const split = (player: Player): [Float64Array, Float64Array | null] => {
    const weights = hands[player].weights
    if (model === undefined || model.player !== player) return [weights, null]
    return [
      Float64Array.from(weights, (weight) => (1 - model.weight) * weight),
      Float64Array.from(weights, (weight) => model.weight * weight),
    ]
  }
  const [free1, fixed1] = split(1)
  const [free0, fixed0] = split(0)
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    walk(root, 0, hands[0].weights, free1, fixed1, iteration)
    walk(root, 1, hands[1].weights, free0, fixed0, iteration)
  }
  // One table per decision, not an array per combo: solutions are cached, and
  // a small array costs several times the numbers it holds.
  const strategy = new Map<string, Float64Array>()
  const collect = (node: Compiled) => {
    if (node.kind !== 'action') return
    const { width, count, sum } = node
    const table = new Float64Array(count * width)
    for (let h = 0; h < count; h += 1) {
      const start = h * width
      let total = 0
      for (let action = 0; action < width; action += 1) total += sum[start + action] as number
      for (let action = 0; action < width; action += 1) {
        table[start + action] = total > 0 ? (sum[start + action] as number) / total : 1 / width
      }
    }
    strategy.set(node.history, table)
    node.children.forEach(collect)
  }
  collect(root)
  return { tree, strategy, spot }
}

/** A decision's strategy as one row per combo (views into its table), found by its history. */
export function strategyRows(solution: RiverSolution, history: string): Float64Array[] | undefined {
  const table = solution.strategy.get(history)
  const node = decisionAt(solution.tree, history)
  if (table === undefined || node === undefined) return undefined
  const width = node.actions.length
  return Array.from({ length: table.length / width }, (_, combo) =>
    table.subarray(combo * width, (combo + 1) * width),
  )
}

function decisionAt(
  node: RiverNode,
  history: string,
): Extract<RiverNode, { kind: 'action' }> | undefined {
  if (node.kind !== 'action') return undefined
  if (node.history === history) return node
  for (const child of node.children) {
    const found = decisionAt(child, history)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * For each of the traverser's holdings, the chips it expects from the river
 * on, summed over the opponent holdings it does not clash with and weighted by
 * their reach: its counterfactual value. With `best`, the traverser plays the
 * best counter to the solution instead of following it.
 */
function counterfactualValues(
  solution: RiverSolution,
  hands: readonly [Hands, Hands],
  traverser: Player,
  best: boolean,
): Float64Array {
  const { spot, tree, strategy } = solution
  const walk = (node: RiverNode, opponent: Float64Array): Float64Array => {
    if (node.kind !== 'action') return terminal(node, traverser, hands, opponent, spot.pot)
    const width = node.actions.length
    const mix =
      strategy.get(node.history) ??
      new Float64Array(hands[node.player].combos.length * width).fill(1 / width)
    if (node.player === traverser) {
      const values = node.children.map((child) => walk(child, opponent))
      return Float64Array.from(hands[traverser].weights, (_, h) =>
        best
          ? Math.max(...values.map((v) => v[h] as number))
          : values.reduce(
              (sum, v, action) => sum + (mix[h * width + action] as number) * (v[h] as number),
              0,
            ),
      )
    }
    const value = new Float64Array(hands[traverser].combos.length)
    node.children.forEach((child, action) => {
      const part = walk(child, scaled(opponent, mix, width, action))
      for (let h = 0; h < value.length; h += 1)
        value[h] = (value[h] as number) + (part[h] as number)
    })
    return value
  }
  const other: Player = traverser === 0 ? 1 : 0
  return walk(tree, hands[other].weights)
}

/**
 * Expected chips per deal for each player when both follow the solution, and
 * what a perfect counter-strategy would gain against it, as a share of the pot.
 */
export function riverReport(solution: RiverSolution): {
  value: readonly [number, number]
  exploitability: number
} {
  const { spot } = solution
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const deals = compatibleWeight(hands[0], hands[1])
  const evaluate = (traverser: Player, best: boolean): number => {
    const values = counterfactualValues(solution, hands, traverser, best)
    let total = 0
    hands[traverser].weights.forEach((w, h) => {
      total += w * (values[h] as number)
    })
    return total / deals
  }
  const value: [number, number] = [evaluate(0, false), evaluate(1, false)]
  const gain = evaluate(0, true) + evaluate(1, true) - value[0] - value[1]
  return { value, exploitability: gain / 2 / spot.pot }
}

/**
 * What each holding is worth from the river on when both players follow the
 * solution: the chips it expects if it is the hand dealt, averaged over the
 * opponent holdings it does not clash with. A fold or a showdown pays what
 * `terminal` pays, so on any one deal the two players' values add up to the
 * pot. These are the answers v9's value network learns (docs/bots.md).
 */
export function riverValues(solution: RiverSolution): {
  hands: readonly [Hands, Hands]
  values: readonly [Float64Array, Float64Array]
  /** For each holding, the opponent's range weight on holdings it does not clash with. */
  masses: readonly [Float64Array, Float64Array]
} {
  const { spot } = solution
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const scratch = scratchFor(hands)
  const massFor = (traverser: Player): Float64Array => {
    const other: Player = traverser === 0 ? 1 : 0
    const mass = new Float64Array(hands[traverser].combos.length)
    compatibleMassInto(
      hands[traverser],
      hands[other],
      hands[other].weights,
      scratch.same[traverser],
      scratch.perCard,
      mass,
    )
    return mass
  }
  const masses = [massFor(0), massFor(1)] as const
  const valuesFor = (traverser: Player): Float64Array => {
    const summed = counterfactualValues(solution, hands, traverser, false)
    const mass = masses[traverser]
    return Float64Array.from(summed, (value, h) => {
      const available = mass[h] as number
      return available > 0 ? value / available : 0
    })
  }
  return { hands, values: [valuesFor(0), valuesFor(1)], masses }
}

/** Reusable working space for settling terminals: per-card sums and one row per holding. */
interface Scratch {
  readonly perCard: Float64Array
  readonly available: Float64Array
  readonly below: Float64Array
  readonly above: Float64Array
  /** For each player's holdings, where the same two cards sit in the other range, or -1. */
  readonly same: readonly [Int32Array, Int32Array]
}

function scratchFor(hands: readonly [Hands, Hands]): Scratch {
  const size = Math.max(hands[0].combos.length, hands[1].combos.length)
  const same = (self: Hands, other: Hands) =>
    Int32Array.from(self.combos, (_, h) => {
      const index = other.byPair.get(
        pairKey(self.cards[2 * h] as number, self.cards[2 * h + 1] as number),
      )
      return index === undefined ? -1 : index
    })
  return {
    perCard: new Float64Array(52),
    available: new Float64Array(size),
    below: new Float64Array(size),
    above: new Float64Array(size),
    same: [same(hands[0], hands[1]), same(hands[1], hands[0])],
  }
}

/** Values at a terminal for every traverser combo, against opponent reach, with clashing cards removed. */
export function terminal(
  node: Exclude<RiverNode, { kind: 'action' }>,
  traverser: Player,
  hands: readonly [Hands, Hands],
  opponent: Float64Array,
  pot: number,
): Float64Array {
  const out = new Float64Array(hands[traverser].combos.length)
  terminalInto(node, traverser, hands, opponent, pot, scratchFor(hands), out)
  return out
}

function terminalInto(
  node: Exclude<RiverNode, { kind: 'action' }>,
  traverser: Player,
  hands: readonly [Hands, Hands],
  opponent: Float64Array,
  pot: number,
  scratch: Scratch,
  out: Float64Array,
): void {
  const self = hands[traverser]
  const other = hands[traverser === 0 ? 1 : 0]
  const total = pot + node.paid[0] + node.paid[1]
  const mine = node.paid[traverser]
  const { available, below, above } = scratch
  compatibleMassInto(self, other, opponent, scratch.same[traverser], scratch.perCard, available)
  const count = self.combos.length
  if (node.kind === 'fold') {
    const payoff = node.folder === traverser ? -mine : total - mine
    for (let h = 0; h < count; h += 1) out[h] = (available[h] as number) * payoff
    return
  }
  sweepInto(self, other, opponent, true, scratch.perCard, below)
  sweepInto(self, other, opponent, false, scratch.perCard, above)
  for (let h = 0; h < count; h += 1) {
    const mass = available[h] as number
    const win = below[h] as number
    const lose = above[h] as number
    out[h] = win * (total - mine) + lose * -mine + (mass - win - lose) * (total / 2 - mine)
  }
}

/**
 * For each traverser combo, the opponent reach on hands strictly weaker
 * (`weaker` true) or strictly stronger, leaving out combos that share a card.
 */
function sweepInto(
  self: Hands,
  other: Hands,
  opponent: Float64Array,
  weaker: boolean,
  perCard: Float64Array,
  into: Float64Array,
): void {
  perCard.fill(0)
  let running = 0
  let j = 0
  const n = self.order.length
  const m = other.order.length
  for (let step = 0; step < n; step += 1) {
    const h = self.order[weaker ? step : n - 1 - step] as number
    const strength = self.strength[h] as number
    while (j < m) {
      const o = other.order[weaker ? j : m - 1 - j] as number
      const s = other.strength[o] as number
      if (weaker ? s >= strength : s <= strength) break
      const r = opponent[o] as number
      running += r
      perCard[other.cards[2 * o] as number] = (perCard[other.cards[2 * o] as number] as number) + r
      perCard[other.cards[2 * o + 1] as number] =
        (perCard[other.cards[2 * o + 1] as number] as number) + r
      j += 1
    }
    into[h] =
      running -
      (perCard[self.cards[2 * h] as number] as number) -
      (perCard[self.cards[2 * h + 1] as number] as number)
  }
}

/** For each traverser combo, the opponent reach on hands that share no card with it. */
function compatibleMassInto(
  self: Hands,
  other: Hands,
  opponent: Float64Array,
  same: Int32Array,
  perCard: Float64Array,
  into: Float64Array,
): void {
  perCard.fill(0)
  let total = 0
  for (let o = 0; o < other.combos.length; o += 1) {
    const r = opponent[o] as number
    total += r
    perCard[other.cards[2 * o] as number] = (perCard[other.cards[2 * o] as number] as number) + r
    perCard[other.cards[2 * o + 1] as number] =
      (perCard[other.cards[2 * o + 1] as number] as number) + r
  }
  for (let h = 0; h < self.combos.length; h += 1) {
    const index = same[h] as number
    into[h] =
      total -
      (perCard[self.cards[2 * h] as number] as number) -
      (perCard[self.cards[2 * h + 1] as number] as number) +
      (index === -1 ? 0 : (opponent[index] as number))
  }
}

/** For each of `self`'s holdings, the opponent `reach` on holdings that share no card with it. */
export function compatibleMasses(self: Hands, other: Hands, reach: Float64Array): Float64Array {
  const scratch = scratchFor([self, other])
  const masses = new Float64Array(self.combos.length)
  compatibleMassInto(self, other, reach, scratch.same[0], scratch.perCard, masses)
  return masses
}

function compatibleWeight(a: Hands, b: Hands): number {
  const scratch = scratchFor([a, b])
  const masses = new Float64Array(a.combos.length)
  compatibleMassInto(a, b, b.weights, scratch.same[0], scratch.perCard, masses)
  let total = 0
  a.weights.forEach((w, h) => {
    total += w * (masses[h] as number)
  })
  return total
}

/** A range with board-blocked combos removed, scored against the board, sorted by strength. */
export function prepare(range: readonly RangeCombo[], board: readonly Card[]): Hands {
  const blocked = new Set(board.map(cardKey))
  const combos = range.filter(
    (combo) =>
      combo.weight > 0 &&
      !blocked.has(cardKey(combo.hole[0])) &&
      !blocked.has(cardKey(combo.hole[1])),
  )
  const cards = new Int32Array(combos.length * 2)
  const strength = new Float64Array(combos.length)
  const byPair = new Map<number, number>()
  combos.forEach((combo, index) => {
    const a = cardKey(combo.hole[0])
    const b = cardKey(combo.hole[1])
    cards[2 * index] = a
    cards[2 * index + 1] = b
    strength[index] = handScore([...combo.hole, ...board])
    byPair.set(pairKey(a, b), index)
  })
  const order = Int32Array.from(combos.keys()).sort(
    (x, y) => (strength[x] as number) - (strength[y] as number),
  )
  return {
    combos,
    weights: Float64Array.from(combos, (combo) => combo.weight),
    strength,
    cards,
    order,
    byPair,
  }
}

/** Where a holding sits in a prepared range, if it is there. */
export function comboIndex(hands: Hands, hole: readonly [Card, Card]): number | undefined {
  return hands.byPair.get(pairKey(cardKey(hole[0]), cardKey(hole[1])))
}

function pairKey(a: number, b: number): number {
  return a < b ? a * 64 + b : b * 64 + a
}

function scaled(
  reach: Float64Array,
  strategy: Float64Array,
  width: number,
  action: number,
): Float64Array {
  return Float64Array.from(reach, (r, index) => r * (strategy[index * width + action] as number))
}
