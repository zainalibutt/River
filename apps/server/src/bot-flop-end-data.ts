import { cardKey, mulberry32, seedFromString } from '@river/engine'
import { type RiverSpot, riverValues } from './bot-river-solver.js'
import { COMBOS, comboIndex52, type RiverRecord } from './bot-river-value-data.js'
import { expectedStrengthRanks, turnEndValues, turnRivers } from './bot-turn-end-data.js'
import { TURN_POLICY_TUNING } from './bot-turn-policy.js'
import { solveTurn } from './bot-turn-solver.js'
import { type RiverValueNetwork, rangeWeights } from './bot-value-network.js'

/**
 * Lane B's flop-end network learns what a flop spot is worth where the flop's
 * betting ends, before the turn card (docs/handoff/ml-roadmap.md). Its answers
 * come from the turn: for each turn card the turn's betting is solved with the
 * turn-end network at its leaves, as the live turn solver plays it, and each
 * holding's value at the start of the turn is averaged over the turn cards the
 * way the deal falls (`turnEndValues`, one street earlier).
 */

/** The turn each answer solves: v9's live turn tree and rounds. */
export const FLOP_DATA_TURN = {
  betSizes: TURN_POLICY_TUNING.betSizes,
  maxRaises: TURN_POLICY_TUNING.maxRaises,
  allIn: true,
  iterations: TURN_POLICY_TUNING.iterations,
} as const

/**
 * Each holding's value at the start of the turn for both players, in pots by
 * `comboIndex52`: the turn solved with the turn-end network at its leaves.
 */
export function turnStartValues(
  turn: RiverSpot,
  network: RiverValueNetwork,
  iterations: number = FLOP_DATA_TURN.iterations,
): readonly [Float64Array, Float64Array] {
  const { hands, values } = riverValues(solveTurn(turn, iterations, network))
  const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const held = hands[player]
    for (let h = 0; h < held.combos.length; h += 1) {
      const index = comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number)
      out[player][index] = (values[player][h] as number) / turn.pot
    }
  }
  return out
}

/**
 * A training record for the flop-end network. `turnCards` of the 49 turn cards
 * are solved, drawn at random from the spot's seed, or all of them when it is
 * 0: a sample gives a noisier answer at a fraction of the cost, and the noise
 * averages out over many records. The flop takes the live turn tree, whatever
 * tree the sampled spot names. The rank row ranks expected strength over the
 * turn cards; the fourth and fifth board cards are 255.
 */
export function flopEndRecord(
  flop: RiverSpot,
  network: RiverValueNetwork,
  turnCards: number,
  meta: { readonly seed: string; readonly spot: number; readonly worker: number },
): RiverRecord {
  if (flop.board.length !== 3) throw new Error('a flop-end spot has three board cards')
  if (turnCards !== 0 && turnCards < 3) {
    throw new Error('solve at least three turn cards, so every holding meets one, or 0 for all')
  }
  const started = performance.now()
  const spot: RiverSpot = {
    ...flop,
    betSizes: FLOP_DATA_TURN.betSizes,
    maxRaises: FLOP_DATA_TURN.maxRaises,
    allIn: FLOP_DATA_TURN.allIn,
  }
  const every = turnRivers(flop.board)
  let turns = every
  if (turnCards !== 0 && turnCards < every.rivers.length) {
    const rng = mulberry32(seedFromString(`${meta.seed}:turns`))
    const order = every.rivers.map((_, at) => at)
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1))
      const swap = order[i] as number
      order[i] = order[j] as number
      order[j] = swap
    }
    const chosen = new Set(order.slice(0, turnCards))
    turns = { board: every.board, rivers: every.rivers.filter((_, at) => chosen.has(at)) }
  }
  const values = turnEndValues(spot, turns, (turn) => turnStartValues(turn, network))
  const weights = rangeWeights(flop)
  const ranges = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const total = weights[player].reduce((sum, weight) => sum + weight, 0)
    for (let index = 0; index < COMBOS; index += 1) {
      ranges[player][index] = (weights[player][index] as number) / total
    }
  }
  return {
    board: [...flop.board.map(cardKey), 255, 255],
    pot: flop.pot,
    stack: flop.stack,
    spot: meta.spot,
    worker: meta.worker,
    iterations: FLOP_DATA_TURN.iterations,
    exploitability: Number.NaN,
    solveMs: performance.now() - started,
    ranges,
    values: [Float32Array.from(values[0]), Float32Array.from(values[1])],
    strengthRank: expectedStrengthRanks(every),
  }
}
