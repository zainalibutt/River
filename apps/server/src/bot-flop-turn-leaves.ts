import { type Card, cardKey, makeDeck } from '@river/engine'
import { FLOP_ALL_IN_RUNOUTS, flopRunouts } from './bot-flop-solver.js'
import type { RiverSpot, ShowdownValues } from './bot-river-solver.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'
import {
  carriedPromises,
  createPromiseRecord,
  type PromiseRecord,
  perCardShowdown,
  type RiverLeafEvaluator,
} from './bot-turn-river-leaves.js'
import { allInFromTable, runoutShowdownTable } from './bot-turn-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'

export type TurnLeafEvaluator = RiverLeafEvaluator
export type TurnPromiseRecord = PromiseRecord
export const createTurnPromiseRecord = createPromiseRecord
export const carriedTurnPromises = carriedPromises

// Layout ranks depend only on the public board, not ranges, paid chips or the
// network. Bound this small cache; repeated decisions on a flop reuse it.
const turnRanks = new Map<string, readonly { card: Card; key: number; ranks: Uint16Array }[]>()

function turnsFor(board: RiverSpot['board']) {
  const key = board.map(cardKey).join(',')
  let turns = turnRanks.get(key)
  if (turns === undefined) {
    const blocked = new Set(board.map(cardKey))
    turns = makeDeck()
      .filter((card) => !blocked.has(cardKey(card)))
      .map((card) => ({
        card,
        key: cardKey(card),
        ranks: expectedStrengthRanks(turnRivers([...board, card])),
      }))
    turnRanks.set(key, turns)
    if (turnRanks.size > 8) turnRanks.delete(turnRanks.keys().next().value as string)
  }
  return turns
}

/**
 * For compatible holdings (h,o), 52 - 3 - 2 - 2 = 45 turn cards remain.
 * M_c(h) is the card-restricted compatible opponent reach, so the old-origin
 * CFV is sum_c M_c(h) * (P' v_c(h) - paid[h]) / 45. Records omit 1/45:
 * next-root promises are (mean CFV / mean compatible own mass + paid[o]) / P'.
 * Turn-start buckets use expected river strength, as in turnStartRecord.
 * All-ins keep the existing flop runout-table semantics and are not recorded.
 */
export function perTurnShowdown(
  spot: RiverSpot,
  network: RiverValueNetwork | TurnLeafEvaluator,
  record?: TurnPromiseRecord,
  runouts = FLOP_ALL_IN_RUNOUTS,
): ShowdownValues {
  if (spot.board.length !== 3) throw new Error('per-turn flop leaves need three board cards')
  if (
    typeof network !== 'function' &&
    (network.checked !== undefined || network.turnBuckets !== undefined)
  ) {
    throw new Error(
      'turn-start leaves need expected-strength buckets without checked-down additions',
    )
  }
  const turns = turnsFor(spot.board)
  let allIn: ReturnType<typeof allInFromTable> | undefined
  return perCardShowdown(
    spot,
    network,
    turns,
    45,
    (...args) => {
      allIn ??= allInFromTable(
        args[2],
        runoutShowdownTable(flopRunouts(spot.board, runouts), args[2]),
      )
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
