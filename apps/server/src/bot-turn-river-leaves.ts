import type { Card } from '@river/engine'
import type { Player, RiverSpot, ShowdownValues } from './bot-river-solver.js'
import { COMBOS } from './bot-river-value-data.js'
import { HOLDING_CARDS, turnRivers } from './bot-turn-end-data.js'
import { allInShowdown, holdingIndices, massesFor } from './bot-turn-solver.js'
import {
  type BucketLayout,
  bucketInputs,
  bucketsFromRanks,
  forwardBatch,
  type RiverValueNetwork,
} from './bot-value-network.js'

/** An injectable river evaluator, with the same units and indexing as riverHoldingValues. */
export type RiverLeafEvaluator = (
  spot: RiverSpot,
  ranks: Uint16Array,
) => readonly [ArrayLike<number>, ArrayLike<number>]

interface CarriedLeaf {
  readonly pot: number
  readonly paid: readonly [number, number]
  readonly present: readonly [Uint8Array, Uint8Array]
  readonly reach: readonly [Float64Array, Float64Array]
  readonly weight: [number, number]
  readonly cards: Map<number, readonly [Float64Array, Float64Array]>
}

/** Use a fresh record for each solve; reading solution values never adds samples. */
export interface PromiseRecord {
  readonly leaves: Map<string, CarriedLeaf>
}

export function createPromiseRecord(): PromiseRecord {
  return { leaves: new Map() }
}

/**
 * Closed turn betting valued on every river, with both reaches card-restricted.
 * Each compatible (h,o) leaves 52 - 4 - 2 - 2 = 44 cards. Thus sum_c M_c(h)
 * is 44 M(h), and the leaf is sum_c M_c(h) (v_c(h) total - mine) / 44.
 * All-ins retain the exact showdown; only non-all-in leaves are recorded.
 */
export function perRiverShowdown(
  spot: RiverSpot,
  riverNetwork: RiverValueNetwork | RiverLeafEvaluator,
  record?: PromiseRecord,
): ShowdownValues {
  if (spot.board.length !== 4) throw new Error('per-river turn leaves need four board cards')
  if (typeof riverNetwork !== 'function' && riverNetwork.checked !== undefined) {
    throw new Error('per-river leaves need a river network without checked-down additions')
  }
  const rivers = turnRivers(spot.board)
  let allIn: ReturnType<typeof allInShowdown> | undefined
  return perCardShowdown(
    spot,
    riverNetwork,
    rivers.rivers,
    44,
    (...args) => {
      allIn ??= allInShowdown(rivers, args[2])
      allIn(
        args[1],
        args[4],
        spot.pot + args[0].paid[0] + args[0].paid[1],
        args[0].paid[args[1]],
        args[5],
      )
    },
    record,
  )
}

/** Shared exact public-card integration, batching, and CFR averaging records. */
export function perCardShowdown(
  spot: RiverSpot,
  riverNetwork: RiverValueNetwork | RiverLeafEvaluator,
  cards: readonly { readonly card: Card; readonly key: number; readonly ranks: Uint16Array }[],
  chanceCards: number,
  allIn: ShowdownValues,
  record?: PromiseRecord,
): ShowdownValues {
  const prepared = cards.map((river) => ({
    ...river,
    board: [...spot.board, river.card],
    layout:
      typeof riverNetwork === 'function'
        ? undefined
        : bucketsFromRanks(river.ranks, riverNetwork.buckets),
  }))
  const reach = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const restricted = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const met = new Float64Array(COMBOS)
  const networkBuffers =
    typeof riverNetwork === 'function'
      ? undefined
      : {
          input: new Float32Array(prepared.length * (3 * riverNetwork.buckets + 1)),
          layers: riverNetwork.layers.map(
            (layer) => new Float32Array(prepared.length * layer.rows),
          ),
          outputs: [
            new Uint8Array(2 * riverNetwork.buckets),
            new Uint8Array(2 * riverNetwork.buckets),
          ] as const,
        }
  let indices: ReturnType<typeof holdingIndices> | undefined
  let masses: ReturnType<typeof massesFor> | undefined
  return (node, traverser, hands, self, opponent, out, visit) => {
    const other = traverser === 0 ? 1 : 0
    const total = spot.pot + node.paid[0] + node.paid[1]
    const behind = spot.stack - Math.max(...node.paid)
    if (behind <= 0) {
      allIn(node, traverser, hands, self, opponent, out, visit)
      return
    }
    if (indices === undefined) {
      indices = holdingIndices(hands)
      if (typeof riverNetwork !== 'function' && networkBuffers !== undefined) {
        for (const player of [0, 1] as const) {
          for (const river of prepared) {
            for (const index of indices[player]) {
              const bucket = river.layout?.bucketOf[index] as number
              if (bucket >= 0)
                networkBuffers.outputs[player][player * riverNetwork.buckets + bucket] = 1
            }
          }
        }
      }
    }
    const holdingIds = indices
    masses ??= massesFor(hands)
    let leaf: CarriedLeaf | undefined
    if (record !== undefined && visit !== undefined) {
      leaf = record.leaves.get(visit.history)
      if (leaf === undefined) {
        const present = [new Uint8Array(COMBOS), new Uint8Array(COMBOS)] as const
        for (const player of [0, 1] as const) {
          for (const index of indices[player]) present[player][index] = 1
        }
        leaf = {
          pot: total,
          paid: node.paid,
          present,
          reach: [new Float64Array(COMBOS), new Float64Array(COMBOS)],
          weight: [0, 0],
          cards: new Map(),
        }
        record.leaves.set(visit.history, leaf)
      }
      // Same recurrence as solveRiver's strategy sums. DCFR sample s at T
      // weighs (s/(T+1))^gamma; CFR+ weighs s. Never average final queries.
      const discount = visit.discount ?? 1
      leaf.weight[traverser] = discount * leaf.weight[traverser] + visit.weight
      for (let h = 0; h < self.length; h += 1) {
        const index = indices[traverser][h] as number
        leaf.reach[traverser][index] =
          discount * (leaf.reach[traverser][index] as number) + visit.weight * (self[h] as number)
      }
    }
    // A branch the traverser never plays still needs values for its regrets, so,
    // as in turnShowdown, the network sees its whole range there.
    let ownTotal = 0
    for (let h = 0; h < self.length; h += 1) ownTotal += self[h] as number
    const ownRange = ownTotal > 0 ? self : hands[traverser].weights
    out.fill(0)
    let batchValues: Float32Array | undefined
    if (typeof riverNetwork !== 'function' && networkBuffers !== undefined) {
      const columns = 3 * riverNetwork.buckets + 1
      for (let r = 0; r < prepared.length; r += 1) {
        const river = prepared[r] as (typeof prepared)[number]
        reach[0].fill(0)
        reach[1].fill(0)
        for (const player of [0, 1] as const) {
          const source = player === traverser ? ownRange : opponent
          for (let h = 0; h < source.length; h += 1) {
            const index = indices[player][h] as number
            if ((river.ranks[index] as number) > 0) reach[player][index] = source[h] as number
          }
        }
        bucketInputs(
          river.layout as BucketLayout,
          reach,
          behind,
          total,
          undefined,
          'live',
          networkBuffers.input.subarray(r * columns, (r + 1) * columns),
        )
      }
      batchValues = forwardBatch(
        riverNetwork,
        networkBuffers.input,
        prepared.length,
        networkBuffers.layers,
        networkBuffers.outputs[traverser],
      )
    }
    for (let r = 0; r < prepared.length; r += 1) {
      const river = prepared[r] as (typeof prepared)[number]
      for (const player of [0, 1] as const) {
        const source = player === traverser ? ownRange : opponent
        for (let h = 0; h < source.length; h += 1) {
          const index = indices[player][h] as number
          const live = (river.ranks[index] as number) > 0
          const weight = live ? (source[h] as number) : 0
          restricted[player][h] = weight
        }
      }
      masses(traverser, restricted[other].subarray(0, opponent.length), met)
      let values: readonly [ArrayLike<number>, ArrayLike<number>] | undefined
      if (typeof riverNetwork === 'function') {
        const without = (player: Player) =>
          hands[player].combos.flatMap((combo, h) =>
            (river.ranks[holdingIds[player][h] as number] as number) > 0
              ? [{ hole: combo.hole, weight: restricted[player][h] as number }]
              : [],
          )
        values = riverNetwork(
          {
            ...spot,
            board: river.board,
            pot: total,
            stack: behind,
            ranges: [without(0), without(1)],
          },
          river.ranks,
        )
      }
      let sums: readonly [Float64Array, Float64Array] | undefined
      if (leaf !== undefined) {
        sums = leaf.cards.get(river.key)
        if (sums === undefined) {
          sums = [new Float64Array(COMBOS), new Float64Array(COMBOS)]
          leaf.cards.set(river.key, sums)
        }
      }
      for (let h = 0; h < out.length; h += 1) {
        const index = indices[traverser][h] as number
        if ((river.ranks[index] as number) === 0) continue
        const bucket = river.layout?.bucketOf[index] as number
        const predicted =
          values === undefined
            ? (batchValues?.[
                r * 2 * (riverNetwork as RiverValueNetwork).buckets +
                  traverser * (riverNetwork as RiverValueNetwork).buckets +
                  bucket
              ] as number)
            : (values[traverser][index] as number)
        const value = (met[h] as number) * (predicted * total - node.paid[traverser])
        out[h] = (out[h] as number) + value / chanceCards
        if (sums !== undefined && visit !== undefined) {
          sums[traverser][index] =
            (visit.discount ?? 1) * (sums[traverser][index] as number) + visit.weight * value
        }
      }
    }
  }
}

/**
 * `player` is us: return opponent promises and our card-restricted carried
 * reach, all by comboIndex52. CFVs are conditioned on c, without the 1/44
 * chance factor (1/45 on the flop). Zero compatible mass (including blocked/absent holdings)
 * has a NaN promise and an explicit marker; zero opponent reach alone does
 * not invalidate a counterfactual promise.
 */
export function carriedPromises(
  record: PromiseRecord,
  leafHistory: string,
  riverCard: number,
  player: Player,
): {
  readonly promises: Float64Array
  readonly reach: Float64Array
  readonly masses: Float64Array
  readonly cfvs: Float64Array
  readonly zeroMass: Uint8Array
} {
  const leaf = record.leaves.get(leafHistory)
  const sums = leaf?.cards.get(riverCard)
  if (leaf === undefined || sums === undefined || leaf.weight[0] <= 0 || leaf.weight[1] <= 0) {
    throw new Error('no two-player CFR record for this leaf and public card')
  }
  const other = player === 0 ? 1 : 0
  const reach = new Float64Array(COMBOS)
  const perCard = new Float64Array(52)
  let total = 0
  for (let h = 0; h < COMBOS; h += 1) {
    const [a, b] = HOLDING_CARDS[h] as readonly [number, number]
    if (a === riverCard || b === riverCard) continue
    const weight = (leaf.reach[player][h] as number) / leaf.weight[player]
    reach[h] = weight
    total += weight
    perCard[a] = (perCard[a] as number) + weight
    perCard[b] = (perCard[b] as number) + weight
  }
  const promises = new Float64Array(COMBOS).fill(Number.NaN)
  const masses = new Float64Array(COMBOS)
  const cfvs = new Float64Array(COMBOS)
  const zeroMass = new Uint8Array(COMBOS).fill(1)
  for (let o = 0; o < COMBOS; o += 1) {
    const [a, b] = HOLDING_CARDS[o] as readonly [number, number]
    if (a === riverCard || b === riverCard || leaf.present[other][o] === 0) continue
    const mass = Math.max(
      0,
      total - (perCard[a] as number) - (perCard[b] as number) + (reach[o] as number),
    )
    const value = (sums[other][o] as number) / leaf.weight[other]
    masses[o] = mass
    cfvs[o] = value
    if (mass <= 0) continue
    zeroMass[o] = 0
    promises[o] = (value / mass + leaf.paid[other]) / leaf.pot
  }
  return { promises, reach, masses, cfvs, zeroMass }
}

// Backward-compatible names for the turn-to-river API.
export type RiverPromiseRecord = PromiseRecord
export const createRiverPromiseRecord = createPromiseRecord
export const carriedRiverPromises = carriedPromises
