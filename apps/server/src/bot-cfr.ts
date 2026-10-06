/**
 * Counterfactual regret minimisation for two-player zero-sum games with
 * imperfect information, and the tools to check what it learns.
 *
 * The solver plays the game against itself. At every decision it asks how
 * much better each action would have done than its current mix, weighted by
 * how often the opponent and chance would have led there, and shifts towards
 * the actions it regrets not taking. The average of its strategies over all
 * iterations converges to an equilibrium, which no opponent can exploit.
 */
export interface CfrGame<State> {
  initial(): State
  isTerminal(state: State): boolean
  /** The first player's winnings at a terminal state; the second player's are the negative. */
  utility(state: State): number
  isChance(state: State): boolean
  chanceOutcomes(state: State): readonly { readonly state: State; readonly probability: number }[]
  player(state: State): 0 | 1
  actions(state: State): readonly string[]
  play(state: State, action: string): State
  /** Everything the acting player knows here, as a key: its own cards and the public history. */
  infoSet(state: State): string
}

/** Action probabilities per information set, in the order `actions` gives them. */
export type Strategy = ReadonlyMap<string, readonly number[]>

interface Node {
  regrets: number[]
  strategySum: number[]
}

/**
 * Runs CFR+ for `iterations` and returns the average strategy. CFR+ floors
 * regrets at zero and weights later iterations more, which converges much
 * faster than the original algorithm on poker games.
 */
export function trainCfr<State>(game: CfrGame<State>, iterations: number): Strategy {
  const nodes = new Map<string, Node>()
  const nodeFor = (key: string, width: number): Node => {
    const found = nodes.get(key)
    if (found !== undefined) return found
    const created = {
      regrets: new Array<number>(width).fill(0),
      strategySum: new Array<number>(width).fill(0),
    }
    nodes.set(key, created)
    return created
  }
  // Returns the first player's expected winnings from `state` under the current strategies.
  const walk = (
    state: State,
    traverser: 0 | 1,
    reach: [number, number],
    chance: number,
    weight: number,
  ): number => {
    if (game.isTerminal(state)) return game.utility(state)
    if (game.isChance(state)) {
      let total = 0
      for (const outcome of game.chanceOutcomes(state)) {
        total +=
          outcome.probability *
          walk(outcome.state, traverser, reach, chance * outcome.probability, weight)
      }
      return total
    }
    const player = game.player(state)
    const actions = game.actions(state)
    const node = nodeFor(game.infoSet(state), actions.length)
    const strategy = matched(node.regrets)
    const values = actions.map((action, index) => {
      const next: [number, number] = [reach[0], reach[1]]
      next[player] *= strategy[index] as number
      return walk(game.play(state, action), traverser, next, chance, weight)
    })
    const value = values.reduce((sum, v, index) => sum + v * (strategy[index] as number), 0)
    if (player === traverser) {
      const sign = player === 0 ? 1 : -1
      const counterfactual = chance * (player === 0 ? reach[1] : reach[0])
      node.regrets = node.regrets.map((regret, index) =>
        Math.max(0, regret + counterfactual * sign * ((values[index] as number) - value)),
      )
      node.strategySum = node.strategySum.map(
        (sum, index) => sum + weight * reach[player] * (strategy[index] as number),
      )
    }
    return value
  }
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    walk(game.initial(), 0, [1, 1], 1, iteration)
    walk(game.initial(), 1, [1, 1], 1, iteration)
  }
  const average = new Map<string, number[]>()
  for (const [key, node] of nodes) {
    const total = node.strategySum.reduce((sum, value) => sum + value, 0)
    average.set(
      key,
      node.strategySum.map((value) => (total > 0 ? value / total : 1 / node.strategySum.length)),
    )
  }
  return average
}

/** The first player's expected winnings when both players follow `strategy`. */
export function expectedValue<State>(game: CfrGame<State>, strategy: Strategy): number {
  const value = (state: State): number => {
    if (game.isTerminal(state)) return game.utility(state)
    if (game.isChance(state)) {
      return game.chanceOutcomes(state).reduce((sum, o) => sum + o.probability * value(o.state), 0)
    }
    const actions = game.actions(state)
    const mix = strategy.get(game.infoSet(state)) ?? uniform(actions.length)
    return actions.reduce(
      (sum, action, index) => sum + (mix[index] as number) * value(game.play(state, action)),
      0,
    )
  }
  return value(game.initial())
}

/**
 * What a perfect counter-strategy to `strategy` wins, averaged over the two
 * seats. Zero means `strategy` is an equilibrium.
 */
export function exploitability<State>(game: CfrGame<State>, strategy: Strategy): number {
  return (bestResponseValue(game, strategy, 0) + bestResponseValue(game, strategy, 1)) / 2
}

/** `player`'s winnings when it best-responds to everyone else following `strategy`. */
export function bestResponseValue<State>(
  game: CfrGame<State>,
  strategy: Strategy,
  player: 0 | 1,
): number {
  const sign = player === 0 ? 1 : -1
  const infoSets = new Map<
    string,
    { depth: number; histories: { state: State; reach: number }[] }
  >()
  const collect = (state: State, reach: number, depth: number): void => {
    if (game.isTerminal(state)) return
    if (game.isChance(state)) {
      for (const o of game.chanceOutcomes(state)) collect(o.state, reach * o.probability, depth)
      return
    }
    const actions = game.actions(state)
    if (game.player(state) === player) {
      const key = game.infoSet(state)
      const entry = infoSets.get(key) ?? { depth, histories: [] }
      entry.histories.push({ state, reach })
      infoSets.set(key, entry)
      for (const action of actions) collect(game.play(state, action), reach, depth + 1)
      return
    }
    const mix = strategy.get(game.infoSet(state)) ?? uniform(actions.length)
    actions.forEach((action, index) => {
      collect(game.play(state, action), reach * (mix[index] as number), depth + 1)
    })
  }
  collect(game.initial(), 1, 0)
  const choice = new Map<string, number>()
  const value = (state: State): number => {
    if (game.isTerminal(state)) return sign * game.utility(state)
    if (game.isChance(state)) {
      return game.chanceOutcomes(state).reduce((sum, o) => sum + o.probability * value(o.state), 0)
    }
    const actions = game.actions(state)
    if (game.player(state) === player) {
      const picked = choice.get(game.infoSet(state))
      if (picked === undefined)
        throw new Error('best response reached an undecided information set')
      return value(game.play(state, actions[picked] as string))
    }
    const mix = strategy.get(game.infoSet(state)) ?? uniform(actions.length)
    return actions.reduce(
      (sum, action, index) => sum + (mix[index] as number) * value(game.play(state, action)),
      0,
    )
  }
  // Decide the deepest information sets first, so every value below a decision is known.
  const ordered = [...infoSets.entries()].sort((a, b) => b[1].depth - a[1].depth)
  for (const [key, entry] of ordered) {
    const actions = game.actions((entry.histories[0] as { state: State }).state)
    let best = 0
    let bestValue = Number.NEGATIVE_INFINITY
    actions.forEach((action, index) => {
      const total = entry.histories.reduce(
        (sum, h) => sum + h.reach * value(game.play(h.state, action)),
        0,
      )
      if (total > bestValue) {
        bestValue = total
        best = index
      }
    })
    choice.set(key, best)
  }
  return value(game.initial())
}

function matched(regrets: readonly number[]): number[] {
  const positive = regrets.map((regret) => Math.max(0, regret))
  const total = positive.reduce((sum, value) => sum + value, 0)
  return total > 0 ? positive.map((value) => value / total) : uniform(regrets.length)
}

function uniform(width: number): number[] {
  return new Array<number>(width).fill(1 / width)
}
