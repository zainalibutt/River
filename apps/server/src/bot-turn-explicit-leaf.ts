import { makeDeck } from '@river/engine'
import { type CfrOptions, type RiverSpot, riverValues, solveRiver } from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { HOLDING_CARDS } from './bot-turn-end-data.js'
import { perRiverShowdown, type RiverLeafEvaluator } from './bot-turn-river-leaves.js'
import {
  type BucketLayout,
  bucketInputs,
  bucketsFromRanks,
  holdingValues,
  type RiverValueNetwork,
} from './bot-value-network.js'

export interface ExplicitTurnSolveLeafOptions extends CfrOptions {
  readonly refreshIterations?: number | 'never'
  readonly iterations: number
  readonly betSizes: readonly number[]
  readonly maxRaises: number
  readonly allIn: boolean
}

/**
 * Diagnostic turn oracle. Like turnResidualLeaf, corrections belong to a
 * solve/terminal and both traversers share the first visit in each epoch.
 * Final reads reuse the latest correction; withRecord creates a new solve.
 * Only the correction is frozen: the plain network always sees current ranges.
 */
export function explicitTurnSolveLeaf(
  network: RiverValueNetwork,
  riverNetwork: RiverValueNetwork | RiverLeafEvaluator,
  options: ExplicitTurnSolveLeafOptions,
): RiverLeafEvaluator {
  const refresh = options.refreshIterations ?? 'never'
  if (refresh !== 'never' && (!Number.isSafeInteger(refresh) || refresh < 1))
    throw new Error('refreshIterations must be a positive integer or never')
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1)
    throw new Error('iterations must be a positive integer')
  if (network.checked !== undefined || network.turnBuckets !== undefined)
    throw new Error('explicit turn baseline needs plain turn-start expected-strength buckets')
  const deck = makeDeck()
  const layouts = new WeakMap<Uint16Array, BucketLayout>()
  const explicit = (spot: RiverSpot) => {
    if (spot.board.length !== 4) throw new Error('explicit turn leaves need four board cards')
    const turn = {
      ...spot,
      betSizes: options.betSizes,
      maxRaises: options.maxRaises,
      allIn: options.allIn,
    }
    const { hands, values } = riverValues(
      solveRiver(
        turn,
        options.iterations,
        undefined,
        perRiverShowdown(turn, riverNetwork),
        undefined,
        undefined,
        options,
      ),
    )
    const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
    for (const p of [0, 1] as const)
      for (let h = 0; h < hands[p].combos.length; h++) {
        const index = comboIndex52(
          hands[p].cards[2 * h] as number,
          hands[p].cards[2 * h + 1] as number,
        )
        // riverValues already divides by compatible opponent mass. Root paid
        // chips are zero here; divide by this turn's pot, with no chance factor.
        out[p][index] = (values[p][h] as number) / turn.pot
      }
    return out
  }
  const cached = new WeakMap<
    object,
    WeakMap<object, { epoch: number; delta: readonly (readonly [Float64Array, Float64Array])[] }>
  >()
  const scalar: RiverLeafEvaluator = (spot) => explicit(spot)
  return Object.assign(scalar, {
    batch: ((boards, ranges, stack, pot, context) => {
      let nodes = cached.get(context.solve)
      if (nodes === undefined) {
        nodes = new WeakMap()
        cached.set(context.solve, nodes)
      }
      const previous = nodes.get(context.node)
      const epoch = refresh === 'never' ? 0 : Math.floor(((context.iteration ?? 1) - 1) / refresh)
      const reuse =
        previous !== undefined && (context.iteration === undefined || previous.epoch === epoch)
      const plain = boards.map(({ ranks }) => {
        let layout = layouts.get(ranks)
        if (layout === undefined) {
          layout = bucketsFromRanks(ranks, network.buckets)
          layouts.set(ranks, layout)
        }
        return holdingValues(network, layout, bucketInputs(layout, ranges, stack, pot))
      })
      const delta = reuse
        ? previous.delta
        : boards.map(({ board, ranks }, i) => {
            const spot: RiverSpot = {
              board,
              pot,
              stack,
              betSizes: options.betSizes,
              maxRaises: options.maxRaises,
              allIn: options.allIn,
              ranges: ranges.map((range) =>
                HOLDING_CARDS.flatMap(([a, b], h) =>
                  ranks[h] && (range[h] as number) > 0
                    ? [
                        {
                          hole: [deck[a], deck[b]] as RiverSpot['ranges'][0][number]['hole'],
                          weight: range[h] as number,
                        },
                      ]
                    : [],
                ),
              ) as unknown as RiverSpot['ranges'],
            }
            const target = explicit(spot)
            return target.map((row, p) =>
              Float64Array.from(row, (v, h) => v - (plain[i]?.[p as 0 | 1][h] as number)),
            ) as unknown as readonly [Float64Array, Float64Array]
          })
      if (!reuse) nodes.set(context.node, { epoch, delta })
      return plain.map(
        (rows, i) =>
          rows.map((row, p) =>
            Float64Array.from(row, (v, h) =>
              boards[i]?.ranks[h] ? v + (delta[i]?.[p as 0 | 1][h] as number) : 0,
            ),
          ) as unknown as readonly [Float64Array, Float64Array],
      )
    }) satisfies NonNullable<RiverLeafEvaluator['batch']>,
  })
}
