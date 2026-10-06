import { readFileSync } from 'node:fs'
import { cardKey } from '@river/engine'
import type { RiverSpot } from './bot-river-solver.js'
import { COMBOS, comboIndex52, strengthRanks } from './bot-river-value-data.js'

/**
 * v9's river value network inside the server (docs/bots.md): the weights
 * trained in PyTorch by ml/train_river_buckets.py, read from their float32
 * export, and the network's maths in plain TypeScript, so the server needs no
 * Python and no native library. A spot's ranges are summarised by strength
 * exactly as in training, and each holding takes its bucket's value.
 */

export interface ValueNetworkLayer {
  /** Row-major, `rows` by `columns`, as PyTorch stores a linear layer. */
  readonly weight: Float32Array
  readonly bias: Float32Array
  readonly rows: number
  readonly columns: number
  /** The slope of the PReLU after this layer, or null for the output layer. */
  readonly slope: number | null
}

export interface RiverValueNetwork {
  readonly buckets: number
  readonly layers: readonly ValueNetworkLayer[]
  /** For a turn-end network trained on two-dimensional buckets, their slices. */
  readonly turnBuckets?: { readonly strength: number; readonly potential: number }
  /**
   * For a turn-end network that learns what betting adds to each holding's
   * checked-down value, its value if nobody bets again: a holding is worth its
   * bucket's output plus its own checked-down value. With `inputs`, the network
   * also sees each bucket's mean checked-down value for both players, over the
   * bucket's live holdings or weighted by the player's range there.
   */
  readonly checked?: { readonly inputs: false | 'live' | 'range' }
}

export interface ValueNetworkDescription {
  readonly buckets: number
  readonly turnBuckets?: { readonly strength: number; readonly potential: number }
  readonly checked?: boolean
  readonly checkedInputs?: boolean | 'live' | 'range'
  readonly tensors: readonly {
    readonly name: string
    readonly shape: readonly number[]
    readonly offset: number
  }[]
}

/**
 * A network from its export: the tensors of a PyTorch Sequential of Linear
 * layers, each but the last followed by a PReLU with one slope, named `0.weight`
 * and so on, or `net.0.weight` when the Sequential sits in a module as `net`.
 */
export function valueNetworkFrom(
  description: ValueNetworkDescription,
  weights: Float32Array,
): RiverValueNetwork {
  const tensor = (name: string): { values: Float32Array; shape: readonly number[] } => {
    const found = description.tensors.find((entry) => entry.name === name)
    if (found === undefined) throw new Error(`value network has no tensor ${name}`)
    const size = found.shape.reduce((product, length) => product * length, 1)
    const start = found.offset / 4
    return { values: weights.subarray(start, start + size), shape: found.shape }
  }
  const prefix = description.tensors.some((entry) => entry.name === 'net.0.weight') ? 'net.' : ''
  const layers: ValueNetworkLayer[] = []
  for (let index = 0; ; index += 2) {
    if (!description.tensors.some((entry) => entry.name === `${prefix}${index}.weight`)) break
    const weight = tensor(`${prefix}${index}.weight`)
    const slopeName = `${prefix}${index + 1}.weight`
    const hasSlope = description.tensors.some((entry) => entry.name === slopeName)
    layers.push({
      weight: weight.values,
      bias: tensor(`${prefix}${index}.bias`).values,
      rows: weight.shape[0] as number,
      columns: weight.shape[1] as number,
      slope: hasSlope ? (tensor(slopeName).values[0] as number) : null,
    })
  }
  if (layers.length === 0) throw new Error('value network has no layers')
  return {
    buckets: description.buckets,
    layers,
    ...(description.turnBuckets === undefined ? {} : { turnBuckets: description.turnBuckets }),
    ...(description.checked === true
      ? {
          checked: {
            inputs:
              description.checkedInputs === true || description.checkedInputs === 'live'
                ? ('live' as const)
                : description.checkedInputs === 'range'
                  ? ('range' as const)
                  : false,
          },
        }
      : {}),
  }
}

/** The network's output for one input. */
export function forward(network: RiverValueNetwork, input: Float32Array): Float32Array {
  let current = input
  for (const layer of network.layers) {
    if (current.length !== layer.columns) {
      throw new Error(`value network layer wants ${layer.columns} inputs, got ${current.length}`)
    }
    const out = new Float32Array(layer.rows)
    for (let r = 0; r < layer.rows; r += 1) {
      let sum = layer.bias[r] as number
      const row = r * layer.columns
      for (let c = 0; c < layer.columns; c += 1) {
        sum += (layer.weight[row + c] as number) * (current[c] as number)
      }
      out[r] = layer.slope === null || sum > 0 ? sum : layer.slope * sum
    }
    current = out
  }
  return current
}

/**
 * Where each holding falls among B buckets of strength: a slice of the live
 * holdings by percentile, each holding placed at the middle of its tie group,
 * so equal ranks share a bucket. `ranks` gives every holding's rank, 1 for the
 * weakest, ties sharing, 0 where blocked: a river's showdown ranks, or on the
 * turn the ranks of expected strength. Returns each holding's bucket (-1 where
 * blocked), the live count and each bucket's share of the live holdings.
 */
export interface BucketLayout {
  readonly bucketOf: Int16Array
  readonly live: number
  readonly held: Float64Array
}

export function bucketsFromRanks(ranks: Uint16Array, buckets: number): BucketLayout {
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
  const bucketOf = new Int16Array(COMBOS).fill(-1)
  const held = new Float64Array(buckets)
  for (let index = 0; index < COMBOS; index += 1) {
    const rank = ranks[index] as number
    if (rank === 0) continue
    const middle = (below[rank] as number) + (counts[rank] as number) / 2
    const bucket = Math.min(Math.floor((middle / live) * buckets), buckets - 1)
    bucketOf[index] = bucket
    held[bucket] = (held[bucket] as number) + 1
  }
  return { bucketOf, live, held }
}

/** A layout from bucket ids given directly, 255 where blocked, as the turn's two-dimensional buckets are. */
export function bucketsFromIds(ids: Uint8Array, buckets: number): BucketLayout {
  const bucketOf = new Int16Array(COMBOS).fill(-1)
  const held = new Float64Array(buckets)
  let live = 0
  for (let index = 0; index < COMBOS; index += 1) {
    const id = ids[index] as number
    if (id === 255) continue
    if (id >= buckets) throw new Error(`bucket ${id} is beyond the network's ${buckets}`)
    bucketOf[index] = id
    held[id] = (held[id] as number) + 1
    live += 1
  }
  return { bucketOf, live, held }
}

/**
 * What the network sees: the log of stack over pot, each player's range mass
 * in each bucket (scaled by the bucket count), and each bucket's share of the
 * live holdings, also scaled. `ranges` are weights by holding, by
 * `comboIndex52`; they need not sum to one. With `checked`, every holding's
 * checked-down value for both players, it also sees each bucket's mean of
 * them, the first player's buckets first: over the bucket's live holdings, or
 * with `weighting` 'range' weighted by the player's range there, 0 where the
 * range has none, which needs only the values of holdings in the range.
 */
export function bucketInputs(
  layout: BucketLayout,
  ranges: readonly [ArrayLike<number>, ArrayLike<number>],
  stack: number,
  pot: number,
  checked?: readonly [ArrayLike<number>, ArrayLike<number>],
  weighting: 'live' | 'range' = 'live',
): Float32Array {
  const buckets = layout.held.length
  const inputs = new Float32Array((checked === undefined ? 3 : 5) * buckets + 1)
  inputs[0] = Math.log(stack / pot)
  ranges.forEach((range, player) => {
    let total = 0
    for (let index = 0; index < COMBOS; index += 1) {
      if ((layout.bucketOf[index] as number) >= 0) total += range[index] as number
    }
    if (total <= 0) return
    for (let index = 0; index < COMBOS; index += 1) {
      const bucket = layout.bucketOf[index] as number
      if (bucket < 0) continue
      const at = 1 + player * buckets + bucket
      inputs[at] = (inputs[at] as number) + ((range[index] as number) / total) * buckets
    }
  })
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    inputs[1 + 2 * buckets + bucket] = ((layout.held[bucket] as number) / layout.live) * buckets
  }
  checked?.forEach((values, player) => {
    const start = 1 + (3 + player) * buckets
    if (weighting === 'range') {
      const range = ranges[player] as ArrayLike<number>
      const mass = new Float64Array(buckets)
      const sum = new Float64Array(buckets)
      for (let index = 0; index < COMBOS; index += 1) {
        const bucket = layout.bucketOf[index] as number
        const weight = range[index] as number
        if (bucket < 0 || weight === 0) continue
        mass[bucket] = (mass[bucket] as number) + weight
        sum[bucket] = (sum[bucket] as number) + weight * (values[index] as number)
      }
      for (let bucket = 0; bucket < buckets; bucket += 1) {
        const total = mass[bucket] as number
        inputs[start + bucket] = total > 0 ? (sum[bucket] as number) / total : 0
      }
      return
    }
    for (let index = 0; index < COMBOS; index += 1) {
      const bucket = layout.bucketOf[index] as number
      if (bucket < 0) continue
      inputs[start + bucket] =
        (inputs[start + bucket] as number) +
        (values[index] as number) / (layout.held[bucket] as number)
    }
  })
  return inputs
}

/** A spot's ranges as weights by `comboIndex52`. */
export function rangeWeights(spot: RiverSpot): readonly [Float64Array, Float64Array] {
  const weights = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const row = weights[player]
    for (const combo of spot.ranges[player]) {
      const index = comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
      row[index] = (row[index] as number) + combo.weight
    }
  }
  return weights
}

/**
 * A river spot as the network sees it, by showdown strength on the board, and
 * each holding's bucket, -1 where the board blocks it.
 */
export function riverBucketInputs(
  spot: RiverSpot,
  buckets: number,
): { inputs: Float32Array; bucketOf: Int16Array } {
  const layout = bucketsFromRanks(strengthRanks(spot.board), buckets)
  return {
    inputs: bucketInputs(layout, rangeWeights(spot), spot.stack, spot.pot),
    bucketOf: layout.bucketOf,
  }
}

/**
 * Every holding's value for both players, in pots, by `comboIndex52`, from
 * bucket inputs. A network that learns what betting adds needs `checked`, each
 * holding's checked-down value, which it adds to its bucket's output.
 */
export function holdingValues(
  network: RiverValueNetwork,
  layout: BucketLayout,
  inputs: Float32Array,
  checked?: readonly [ArrayLike<number>, ArrayLike<number>],
): readonly [Float32Array, Float32Array] {
  if (network.checked !== undefined && checked === undefined) {
    throw new Error('this network needs the checked-down value of every holding')
  }
  const added = network.checked === undefined ? undefined : checked
  const out = forward(network, inputs)
  const values = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (let index = 0; index < COMBOS; index += 1) {
    const bucket = layout.bucketOf[index] as number
    if (bucket < 0) continue
    values[0][index] =
      (out[bucket] as number) + (added === undefined ? 0 : (added[0][index] as number))
    values[1][index] =
      (out[network.buckets + bucket] as number) +
      (added === undefined ? 0 : (added[1][index] as number))
  }
  return values
}

/** Every holding's value from the river on for both players, in pots, as the network sees the spot. */
export function riverHoldingValues(
  network: RiverValueNetwork,
  spot: RiverSpot,
  ranks: Uint16Array = strengthRanks(spot.board),
): readonly [Float32Array, Float32Array] {
  const layout = bucketsFromRanks(ranks, network.buckets)
  return holdingValues(
    network,
    layout,
    bucketInputs(layout, rangeWeights(spot), spot.stack, spot.pot),
  )
}

/** A network from its export on disk: `<stem>.json` and `<stem>.bin`. */
export function loadValueNetwork(stem: string): RiverValueNetwork {
  const description = JSON.parse(readFileSync(`${stem}.json`, 'utf8')) as ValueNetworkDescription
  const raw = readFileSync(`${stem}.bin`)
  return valueNetworkFrom(
    description,
    new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
  )
}

/**
 * The turn-end network the measuring tools play v9a with, from the
 * RIVER_TURN_NETWORK environment variable (an export's path without .bin), so
 * no machine's paths live in the repository.
 */
export function turnNetworkFromEnvironment(): RiverValueNetwork {
  const stem = process.env.RIVER_TURN_NETWORK
  if (stem === undefined || stem === '') {
    throw new Error('v9a needs RIVER_TURN_NETWORK: the turn-end network export, without .bin')
  }
  return loadValueNetwork(stem)
}
