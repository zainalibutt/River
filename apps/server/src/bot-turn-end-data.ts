import { type Card, cardKey, makeDeck } from '@river/engine'
import type { RangeCombo, RiverSpot } from './bot-river-solver.js'
import { COMBOS, type RiverRecord, strengthRanks } from './bot-river-value-data.js'
import {
  type BucketLayout,
  bucketsFromIds,
  bucketsFromRanks,
  type RiverValueNetwork,
  rangeWeights,
  riverHoldingValues,
} from './bot-value-network.js'

/**
 * v9's turn-end network learns what a turn spot is worth where the turn's
 * betting ends, before the river card (docs/bots.md). Its answers come from
 * the river network, averaged over every river card the way the deal falls,
 * so making them needs no solving. On the turn a holding's strength is not yet
 * settled, so its buckets order holdings by expected strength: the holding's
 * showdown percentile on each river that can come, averaged.
 */

/** The two card keys of every holding, by its place among the 1,326. */
const HOLDING_CARDS: readonly (readonly [number, number])[] = (() => {
  const cards: [number, number][] = []
  for (let a = 0; a < 52; a += 1) {
    for (let b = a + 1; b < 52; b += 1) cards.push([a, b])
  }
  return cards
})()

export interface TurnRivers {
  readonly board: readonly Card[]
  /** Every river card that can come, with the showdown ranks of the board it makes. */
  readonly rivers: readonly {
    readonly card: Card
    readonly key: number
    readonly ranks: Uint16Array
  }[]
}

export function turnRivers(board: readonly Card[]): TurnRivers {
  const blocked = new Set(board.map(cardKey))
  return {
    board,
    rivers: makeDeck()
      .filter((card) => !blocked.has(cardKey(card)))
      .map((card) => ({ card, key: cardKey(card), ranks: strengthRanks([...board, card]) })),
  }
}

/**
 * Each holding's rank by expected strength on a turn, 1 for the weakest, ties
 * sharing, 0 where the board blocks it: its showdown percentile on each river
 * it can meet, at the middle of its tie group there, averaged over them.
 */
export function expectedStrengthRanks(turn: TurnRivers): Uint16Array {
  const sum = new Float64Array(COMBOS)
  const seen = new Float64Array(COMBOS)
  for (const { ranks } of turn.rivers) {
    let live = 0
    const counts = new Float64Array(COMBOS + 1)
    for (let index = 0; index < COMBOS; index += 1) {
      const rank = ranks[index] as number
      if (rank === 0) continue
      live += 1
      counts[rank] = (counts[rank] as number) + 1
    }
    const below = new Float64Array(COMBOS + 1)
    for (let rank = 1; rank <= COMBOS; rank += 1) {
      below[rank] = (below[rank - 1] as number) + (counts[rank - 1] as number)
    }
    for (let index = 0; index < COMBOS; index += 1) {
      const rank = ranks[index] as number
      if (rank === 0) continue
      sum[index] =
        (sum[index] as number) + ((below[rank] as number) + (counts[rank] as number) / 2) / live
      seen[index] = (seen[index] as number) + 1
    }
  }
  const live: { index: number; mean: number }[] = []
  for (let index = 0; index < COMBOS; index += 1) {
    if ((seen[index] as number) > 0) {
      live.push({ index, mean: (sum[index] as number) / (seen[index] as number) })
    }
  }
  live.sort((x, y) => x.mean - y.mean)
  const ranks = new Uint16Array(COMBOS)
  let rank = 0
  let previous = Number.NEGATIVE_INFINITY
  for (const { index, mean } of live) {
    if (mean > previous) {
      rank += 1
      previous = mean
    }
    ranks[index] = rank
  }
  return ranks
}

/**
 * Each holding's value where the turn's betting ends, in pots, for both
 * players: its value on every river that can come, weighted on each by the
 * opponent's weight on the holdings it can meet there, which is how the deal
 * falls. `riverValuesOf` gives every holding's value in pots on a river spot,
 * by `comboIndex52`.
 */
export function turnEndValues(
  turn: RiverSpot,
  rivers: TurnRivers,
  riverValuesOf: (
    river: RiverSpot,
    ranks: Uint16Array,
  ) => readonly [ArrayLike<number>, ArrayLike<number>],
): readonly [Float64Array, Float64Array] {
  const weights = rangeWeights(turn)
  const blocked = new Set(turn.board.map(cardKey))
  const sums = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const masses = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  for (const river of rivers.rivers) {
    const without = (range: readonly RangeCombo[]) =>
      range.filter(
        (combo) => cardKey(combo.hole[0]) !== river.key && cardKey(combo.hole[1]) !== river.key,
      )
    const spot: RiverSpot = {
      ...turn,
      board: [...turn.board, river.card],
      ranges: [without(turn.ranges[0]), without(turn.ranges[1])],
    }
    const values = riverValuesOf(spot, river.ranks)
    for (const player of [0, 1] as const) {
      const other = weights[player === 0 ? 1 : 0]
      const perCard = new Float64Array(52)
      let total = 0
      for (let index = 0; index < COMBOS; index += 1) {
        const weight = other[index] as number
        if (weight === 0) continue
        const [a, b] = HOLDING_CARDS[index] as readonly [number, number]
        if (a === river.key || b === river.key) continue
        total += weight
        perCard[a] = (perCard[a] as number) + weight
        perCard[b] = (perCard[b] as number) + weight
      }
      for (let index = 0; index < COMBOS; index += 1) {
        const [a, b] = HOLDING_CARDS[index] as readonly [number, number]
        if (a === river.key || b === river.key || blocked.has(a) || blocked.has(b)) continue
        const mass =
          total - (perCard[a] as number) - (perCard[b] as number) + (other[index] as number)
        sums[player][index] =
          (sums[player][index] as number) + mass * (values[player][index] as number)
        masses[player][index] = (masses[player][index] as number) + mass
      }
    }
  }
  const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    for (let index = 0; index < COMBOS; index += 1) {
      const mass = masses[player][index] as number
      out[player][index] = mass > 0 ? (sums[player][index] as number) / mass : 0
    }
  }
  return out
}

/**
 * A training record for the turn-end network: a turn spot, its answers from
 * the river network, and each holding's rank by expected strength in the
 * rank row. The fifth board card is 255, for none.
 */
export function turnEndRecord(
  turn: RiverSpot,
  network: RiverValueNetwork,
  meta: { readonly spot: number; readonly worker: number },
): RiverRecord {
  const started = performance.now()
  const rivers = turnRivers(turn.board)
  const values = turnEndValues(turn, rivers, (spot, ranks) =>
    riverHoldingValues(network, spot, ranks),
  )
  const weights = rangeWeights(turn)
  const ranges = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const total = weights[player].reduce((sum, weight) => sum + weight, 0)
    for (let index = 0; index < COMBOS; index += 1) {
      ranges[player][index] = (weights[player][index] as number) / total
    }
  }
  return {
    board: [...turn.board.map(cardKey), 255],
    pot: turn.pot,
    stack: turn.stack,
    spot: meta.spot,
    worker: meta.worker,
    iterations: 0,
    exploitability: Number.NaN,
    solveMs: performance.now() - started,
    ranges,
    values: [Float32Array.from(values[0]), Float32Array.from(values[1])],
    strengthRank: expectedStrengthRanks(rivers),
  }
}

/**
 * Each holding's bucket on a turn, in two dimensions: first by expected
 * strength, into `strengthBins` slices of the live holdings (ties together),
 * then within each slice by potential, the spread of its showdown percentile
 * across the rivers, into `potentialBins`. A draw and a made hand with the
 * same expected strength swing very differently, and value differently under
 * betting, so they land in different buckets. 255 where the board blocks.
 */
export function turnBucketIds(
  turn: TurnRivers,
  strengthBins: number,
  potentialBins: number,
): Uint8Array {
  const sum = new Float64Array(COMBOS)
  const squares = new Float64Array(COMBOS)
  const seen = new Float64Array(COMBOS)
  for (const { ranks } of turn.rivers) {
    let live = 0
    const counts = new Float64Array(COMBOS + 1)
    for (let index = 0; index < COMBOS; index += 1) {
      const rank = ranks[index] as number
      if (rank === 0) continue
      live += 1
      counts[rank] = (counts[rank] as number) + 1
    }
    const below = new Float64Array(COMBOS + 1)
    for (let rank = 1; rank <= COMBOS; rank += 1) {
      below[rank] = (below[rank - 1] as number) + (counts[rank - 1] as number)
    }
    for (let index = 0; index < COMBOS; index += 1) {
      const rank = ranks[index] as number
      if (rank === 0) continue
      const percentile = ((below[rank] as number) + (counts[rank] as number) / 2) / live
      sum[index] = (sum[index] as number) + percentile
      squares[index] = (squares[index] as number) + percentile * percentile
      seen[index] = (seen[index] as number) + 1
    }
  }
  const live: { index: number; mean: number; spread: number }[] = []
  for (let index = 0; index < COMBOS; index += 1) {
    const count = seen[index] as number
    if (count === 0) continue
    const mean = (sum[index] as number) / count
    const variance = Math.max(0, (squares[index] as number) / count - mean * mean)
    live.push({ index, mean, spread: Math.sqrt(variance) })
  }
  live.sort((x, y) => x.mean - y.mean)
  // Strength slices by the middle of each tie group's percentile, as bucketsFromRanks does.
  const strengthOf = new Int32Array(live.length)
  for (let start = 0; start < live.length; ) {
    let end = start + 1
    while (
      end < live.length &&
      (live[end] as { mean: number }).mean === (live[start] as { mean: number }).mean
    )
      end += 1
    const middle = (start + end) / 2
    const bin = Math.min(Math.floor((middle / live.length) * strengthBins), strengthBins - 1)
    for (let i = start; i < end; i += 1) strengthOf[i] = bin
    start = end
  }
  const ids = new Uint8Array(COMBOS).fill(255)
  for (let bin = 0; bin < strengthBins; bin += 1) {
    const members: { index: number; spread: number }[] = []
    live.forEach((holding, i) => {
      if (strengthOf[i] === bin) members.push(holding)
    })
    members.sort((x, y) => x.spread - y.spread)
    members.forEach((holding, i) => {
      const potential = Math.min(
        Math.floor((i / members.length) * potentialBins),
        potentialBins - 1,
      )
      ids[holding.index] = bin * potentialBins + potential
    })
  }
  return ids
}

/**
 * How a turn-end network sees a turn's holdings: by its two-dimensional
 * buckets when it was trained on them, otherwise by expected strength alone.
 */
export function turnLayout(turn: TurnRivers, network: RiverValueNetwork): BucketLayout {
  return network.turnBuckets === undefined
    ? bucketsFromRanks(expectedStrengthRanks(turn), network.buckets)
    : bucketsFromIds(
        turnBucketIds(turn, network.turnBuckets.strength, network.turnBuckets.potential),
        network.buckets,
      )
}
