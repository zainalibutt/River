import { cardKey, makeDeck, mulberry32, seedFromString } from '@river/engine'
import { flopLayout } from './bot-flop-buckets.js'
import {
  type RiverGadget,
  type RiverSolution,
  type RiverSpot,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS, strengthRanks } from './bot-river-value-data.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'
import {
  allInFromTable,
  holdingIndices,
  massesFor,
  runoutShowdownTable,
  type ShowdownTable,
} from './bot-turn-solver.js'
import { bucketInputs, holdingValues, type RiverValueNetwork } from './bot-value-network.js'

/**
 * Lane B's flop solver (docs/handoff/ml-roadmap.md): CFR+ over the flop's
 * betting, as the turn solver works a street later. Betting that closes with
 * chips behind is valued by the flop-end network; betting that closes with a
 * player all in is settled as the showdown averaged over `runouts` turn and
 * river cards, drawn from the board's seed so the same flop always gets the
 * same ones. The spot's board has three cards. With a `gadget`, the solve is a
 * safe re-solve from promises (see `RiverGadget`).
 */
export function solveFlop(
  spot: RiverSpot,
  iterations: number,
  network: RiverValueNetwork,
  gadget?: RiverGadget,
  runouts = FLOP_ALL_IN_RUNOUTS,
): RiverSolution & { readonly followShare?: Float64Array } {
  if (spot.board.length !== 3) throw new Error('a flop solve takes a three-card board')
  return solveRiver(spot, iterations, undefined, flopShowdown(spot, network, runouts), gadget)
}

/** Turn and river cards an all-in on the flop is averaged over, of the 1,176 there are. */
export const FLOP_ALL_IN_RUNOUTS = 60

/** `runouts` distinct turn and river pairs for a flop, the same ones every time for that flop. */
export function flopRunouts(
  board: RiverSpot['board'],
  runouts: number,
): readonly { readonly ranks: Uint16Array }[] {
  const blocked = new Set(board.map(cardKey))
  const live = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const pairs: [number, number][] = []
  for (let a = 0; a < live.length; a += 1) {
    for (let b = a + 1; b < live.length; b += 1) pairs.push([a, b])
  }
  const rng = mulberry32(seedFromString(`runouts:${board.map(cardKey).join(',')}`))
  for (let i = pairs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const swap = pairs[i] as [number, number]
    pairs[i] = pairs[j] as [number, number]
    pairs[j] = swap
  }
  return pairs.slice(0, Math.min(runouts, pairs.length)).map(([a, b]) => ({
    ranks: strengthRanks([...board, live[a], live[b]] as RiverSpot['board']),
  }))
}

/** How the flop's closed betting is valued: by the network with chips behind, by the runouts all in. */
export function flopShowdown(
  spot: RiverSpot,
  network: RiverValueNetwork,
  runouts = FLOP_ALL_IN_RUNOUTS,
): ShowdownValues {
  if (network.checked !== undefined) {
    throw new Error('the flop solver takes a network without checked-down inputs')
  }
  const layout = flopLayout(spot.board, expectedStrengthRanks(turnRivers(spot.board)), network)
  const reach = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const met = new Float64Array(COMBOS)
  let indices: ReturnType<typeof holdingIndices> | undefined
  let masses: ReturnType<typeof massesFor> | undefined
  let table: ShowdownTable | undefined
  let allIn: ReturnType<typeof allInFromTable> | undefined
  return (node, traverser, hands, self, opponent, out) => {
    const other = traverser === 0 ? 1 : 0
    const total = spot.pot + node.paid[0] + node.paid[1]
    const mine = node.paid[traverser]
    const behind = spot.stack - Math.max(node.paid[0], node.paid[1])
    if (behind <= 0) {
      table ??= runoutShowdownTable(flopRunouts(spot.board, runouts), hands)
      allIn ??= allInFromTable(hands, table)
      allIn(traverser, opponent, total, mine, out)
      return
    }
    indices ??= holdingIndices(hands)
    const own = indices[traverser]
    const theirs = indices[other]
    reach[traverser].fill(0)
    reach[other].fill(0)
    // As on the turn: a range that cannot reach here is valued as its whole range.
    let ownTotal = 0
    for (let h = 0; h < self.length; h += 1) ownTotal += self[h] as number
    const ownRange = ownTotal > 0 ? self : hands[traverser].weights
    for (let h = 0; h < own.length; h += 1)
      reach[traverser][own[h] as number] = ownRange[h] as number
    for (let o = 0; o < theirs.length; o += 1)
      reach[other][theirs[o] as number] = opponent[o] as number
    masses ??= massesFor(hands)
    masses(traverser, opponent, met)
    const values = holdingValues(
      network,
      layout,
      bucketInputs(layout, [reach[0], reach[1]], behind, total),
    )[traverser]
    for (let h = 0; h < own.length; h += 1) {
      out[h] = (met[h] as number) * ((values[own[h] as number] as number) * total - mine)
    }
  }
}
