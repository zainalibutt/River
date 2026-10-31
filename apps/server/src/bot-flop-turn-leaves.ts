import { type Card, cardKey, makeDeck } from '@river/engine'
import { flopDiagnosticsFromEnvironment } from './bot-flop-diagnostics.js'
import { flopRunouts } from './bot-flop-solver.js'
import type { RiverSpot } from './bot-river-solver.js'
import { strengthRanks } from './bot-river-value-data.js'
import { bufferBytes } from './bot-solver-memory.js'
import { expectedStrengthRanks } from './bot-turn-end-data.js'
import {
  carriedPromises,
  createPromiseRecord,
  type LeafProfile,
  type PerCardShowdown,
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

/** Constructor opt-in. Final value reads always use network, even with K=0. */
export interface TurnStartLeafOptions {
  readonly network: RiverValueNetwork | TurnLeafEvaluator
  readonly earlyNetwork?: RiverValueNetwork | TurnLeafEvaluator
  readonly lastIterations?: number
  readonly profile?: LeafProfile
  readonly earlyProfile?: LeafProfile
}

// Layout ranks depend only on the public board, not ranges, paid chips or the
// network. Bound this small cache; repeated decisions on a flop reuse it.
const turnRanks = new Map<string, readonly { card: Card; key: number; ranks: Uint16Array }[]>()

export function flopTurnLayoutMemory() {
  return { entries: turnRanks.size, bytes: bufferBytes(turnRanks) }
}

function turnsFor(board: RiverSpot['board']) {
  const key = board.map(cardKey).join(',')
  let turns = turnRanks.get(key)
  if (turns === undefined) {
    const blocked = new Set(board.map(cardKey))
    const live = makeDeck().filter((card) => !blocked.has(cardKey(card)))
    // Swapping the turn and river leaves the exact final showdown ranks unchanged.
    // Keep each turn's river order, so expected-strength additions still round identically.
    // This temporary cache is released after preparing this flop (about 3 MB).
    const runouts = new Map<number, Uint16Array>()
    turns = live.map((card) => ({
      card,
      key: cardKey(card),
      ranks: expectedStrengthRanks({
        board: [...board, card],
        rivers: live
          .filter((river) => river !== card)
          .map((river) => {
            const a = cardKey(card)
            const b = cardKey(river)
            const pair = Math.min(a, b) * 52 + Math.max(a, b)
            let ranks = runouts.get(pair)
            if (ranks === undefined) {
              ranks = strengthRanks([...board, card, river])
              runouts.set(pair, ranks)
            }
            return { card: river, key: b, ranks }
          }),
      }),
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
  runouts = flopDiagnosticsFromEnvironment().allInRunouts,
  options?: TurnStartLeafOptions & { readonly iterations: number },
): PerCardShowdown {
  if (options !== undefined) {
    const { lastIterations, iterations } = options
    if (!Number.isSafeInteger(iterations) || iterations < 1)
      throw new Error('iterations must be a positive integer')
    if (
      lastIterations !== undefined &&
      (!Number.isSafeInteger(lastIterations) || lastIterations < 0 || lastIterations > iterations)
    )
      throw new Error('lastIterations must be an integer between zero and iterations')
    // Attach profiling to the actual batched and callback inference paths.
    const build = (source: RiverValueNetwork | TurnLeafEvaluator, profile?: LeafProfile) =>
      perTurnShowdownProfiled(spot, source, record, runouts, profile)
    const expensive = build(options.network, options.profile)
    const early =
      lastIterations === undefined || lastIterations === iterations
        ? expensive
        : build(options.earlyNetwork ?? network, options.earlyProfile)
    const withRecord = (nextRecord?: TurnPromiseRecord): PerCardShowdown => {
      const final = expensive.withRecord(nextRecord)
      const initial = early.withRecord(nextRecord)
      return Object.assign(
        (...args: Parameters<PerCardShowdown>) => {
          const iteration = args[6]?.iteration
          const useEarly =
            lastIterations !== undefined &&
            iteration !== undefined &&
            iteration <= iterations - lastIterations &&
            spot.stack > Math.max(...args[0].paid)
          return (useEarly ? initial : final)(...args)
        },
        { withRecord },
      )
    }
    return withRecord(record)
  }
  return perTurnShowdownProfiled(spot, network, record, runouts)
}

function perTurnShowdownProfiled(
  spot: RiverSpot,
  network: RiverValueNetwork | TurnLeafEvaluator,
  record?: TurnPromiseRecord,
  runouts = flopDiagnosticsFromEnvironment().allInRunouts,
  profile?: LeafProfile,
): PerCardShowdown {
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
    profile,
  )
}
