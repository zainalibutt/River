import { cardKey } from '@river/engine'
import { FLOP_DATA_TURN } from './bot-flop-end-data.js'
import { type RiverSpot, riverValues, solveRiver } from './bot-river-solver.js'
import {
  COMBOS,
  comboIndex52,
  decodeRiverRecord,
  encodeRiverRecord,
  RIVER_RECORD_LAYOUT,
  type RiverRecord,
} from './bot-river-value-data.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'
import { perRiverShowdown } from './bot-turn-river-leaves.js'
import { turnShowdown } from './bot-turn-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'

export type TurnStartLeaves =
  | { readonly kind: 'turn-end'; readonly network: RiverValueNetwork }
  | { readonly kind: 'per-river'; readonly riverNetwork: RiverValueNetwork }

/** Byte 5 was padding in river/turn-end records (zero); rows keep their offsets. */
export const TURN_START_TARGETS = {
  'turn-start/turn-end-v1': 1,
  'turn-start/per-river-v1': 2,
} as const
export type TurnStartTarget = keyof typeof TURN_START_TARGETS
export interface TurnStartRecord extends RiverRecord {
  readonly target: TurnStartTarget
}
export const TURN_START_RECORD_LAYOUT = [
  RIVER_RECORD_LAYOUT[0],
  { field: 'target', type: 'uint8', count: 1, offset: 5 },
  ...RIVER_RECORD_LAYOUT.slice(1),
]

export function turnStartTarget(leaves: TurnStartLeaves): TurnStartTarget {
  return leaves.kind === 'turn-end' ? 'turn-start/turn-end-v1' : 'turn-start/per-river-v1'
}

/** Full live turn solve, root values in pots by comboIndex52, before anyone bets. */
export function turnStartRecord(
  spot: RiverSpot,
  leaves: TurnStartLeaves,
  meta: { readonly spot: number; readonly worker: number },
  /** Oracle tests can replace the betting tree with checks only. */
  tree: Pick<RiverSpot, 'betSizes' | 'maxRaises' | 'allIn'> = FLOP_DATA_TURN,
): TurnStartRecord {
  if (spot.board.length !== 4) throw new Error('a turn-start spot has four board cards')
  const started = performance.now()
  const turn = { ...spot, ...tree }
  const evaluator =
    leaves.kind === 'turn-end'
      ? turnShowdown(turn, leaves.network)
      : perRiverShowdown(turn, leaves.riverNetwork)
  const { hands, values } = riverValues(
    solveRiver(turn, FLOP_DATA_TURN.iterations, undefined, evaluator),
  )
  const ranges = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  const scaled = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const held = hands[player]
    const total = held.weights.reduce((sum, weight) => sum + weight, 0)
    for (let h = 0; h < held.combos.length; h += 1) {
      const index = comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number)
      ranges[player][index] = (held.weights[h] as number) / total
      scaled[player][index] = (values[player][h] as number) / turn.pot
    }
  }
  return {
    target: turnStartTarget(leaves),
    board: [...turn.board.map(cardKey), 255],
    pot: turn.pot,
    stack: turn.stack,
    ...meta,
    iterations: FLOP_DATA_TURN.iterations,
    exploitability: Number.NaN,
    solveMs: performance.now() - started,
    ranges,
    values: scaled,
    strengthRank: expectedStrengthRanks(turnRivers(turn.board)),
  }
}

export function encodeTurnStartRecord(record: TurnStartRecord): Uint8Array {
  const bytes = encodeRiverRecord(record)
  bytes[5] = TURN_START_TARGETS[record.target]
  return bytes
}

export function decodeTurnStartRecord(bytes: Uint8Array, offset = 0): TurnStartRecord {
  const target = (Object.keys(TURN_START_TARGETS) as TurnStartTarget[]).find(
    (key) => TURN_START_TARGETS[key] === bytes[offset + 5],
  )
  if (target === undefined) throw new Error('not a tagged turn-start record')
  return { ...decodeRiverRecord(bytes, offset), target }
}
