import {
  type Hands,
  type RiverOpponentModel,
  type RiverSolution,
  type RiverSpot,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { type TurnRivers, turnLayout, turnRivers } from './bot-turn-end-data.js'
import { bucketInputs, holdingValues, type RiverValueNetwork } from './bot-value-network.js'

/**
 * Solves a two-player turn the way v8z solves the river (docs/bots.md):
 * CFR+ over the turn's betting, with whatever follows it valued rather than
 * played out. Betting that closes with chips behind goes on to the river, and
 * the turn-end network says what each holding is worth there; betting that
 * closes with a player all in is settled exactly, as the showdown averaged
 * over every river card. The spot's board has four cards.
 */
export function solveTurn(
  spot: RiverSpot,
  iterations: number,
  network: RiverValueNetwork,
  model?: RiverOpponentModel,
): RiverSolution {
  return solveRiver(spot, iterations, model, turnShowdown(spot, network))
}

/** Every prepared holding's place among the 1,326, by player. */
function holdingIndices(hands: readonly [Hands, Hands]): readonly [Int32Array, Int32Array] {
  const of = (held: Hands) =>
    Int32Array.from(held.combos, (_, h) =>
      comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number),
    )
  return [of(hands[0]), of(hands[1])]
}

/**
 * For each of the traverser's holdings, the opponent's reach on holdings that
 * share no card with it, built once for a solve's holdings and reused, since
 * the solver asks at every closed node of every round.
 */
function massesFor(
  hands: readonly [Hands, Hands],
): (traverser: 0 | 1, opponent: Float64Array, out: Float64Array) => Float64Array {
  const side = (held: Hands, other: Hands) => {
    const count = held.combos.length
    const a = new Int32Array(count)
    const b = new Int32Array(count)
    const same = new Int32Array(count)
    for (let h = 0; h < count; h += 1) {
      const x = held.cards[2 * h] as number
      const y = held.cards[2 * h + 1] as number
      a[h] = x
      b[h] = y
      same[h] = other.byPair.get(x < y ? x * 64 + y : y * 64 + x) ?? -1
    }
    return { a, b, same }
  }
  const sides = [side(hands[0], hands[1]), side(hands[1], hands[0])] as const
  const perCard = new Float64Array(52)
  return (traverser, opponent, out) => {
    const mine = sides[traverser]
    const theirs = sides[traverser === 0 ? 1 : 0]
    perCard.fill(0)
    let total = 0
    for (let o = 0; o < opponent.length; o += 1) {
      const r = opponent[o] as number
      total += r
      perCard[theirs.a[o] as number] = (perCard[theirs.a[o] as number] as number) + r
      perCard[theirs.b[o] as number] = (perCard[theirs.b[o] as number] as number) + r
    }
    for (let h = 0; h < mine.a.length; h += 1) {
      const same = mine.same[h] as number
      out[h] =
        total -
        (perCard[mine.a[h] as number] as number) -
        (perCard[mine.b[h] as number] as number) +
        (same >= 0 ? (opponent[same] as number) : 0)
    }
    return out
  }
}

/**
 * How the turn's closed betting is valued: by the turn-end network while chips
 * remain behind, and by the exact average showdown once a player is all in. A
 * network that learns what betting adds gets each holding's checked-down
 * value from the same showdown table the all-ins use, and one that sees the
 * buckets' checked-down values gets them weighted by range, since the table
 * holds only the ranges' holdings.
 */
export function turnShowdown(spot: RiverSpot, network: RiverValueNetwork): ShowdownValues {
  if (network.checked?.inputs === 'live') {
    throw new Error('the turn solver gives a network checked-down inputs weighted by range only')
  }
  const rivers = turnRivers(spot.board)
  const layout = turnLayout(rivers, network)
  const reach = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const checked = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  let indices: readonly [Int32Array, Int32Array] | undefined
  let table: ShowdownTable | undefined
  let allIn: AllInShowdown | undefined
  let masses: ReturnType<typeof massesFor> | undefined
  const met = new Float64Array(COMBOS)
  const won = new Float64Array(COMBOS)
  const metOther = new Float64Array(COMBOS)
  const wonOther = new Float64Array(COMBOS)
  return (node, traverser, hands, self, opponent, out) => {
    const other = traverser === 0 ? 1 : 0
    const total = spot.pot + node.paid[0] + node.paid[1]
    const mine = node.paid[traverser]
    const behind = spot.stack - Math.max(node.paid[0], node.paid[1])
    if (behind <= 0) {
      table ??= showdownTable(rivers, hands)
      allIn ??= allInShowdown(rivers, hands, table)
      allIn(traverser, opponent, total, mine, out)
      return
    }
    indices ??= holdingIndices(hands)
    const own = indices[traverser]
    const theirs = indices[other]
    reach[traverser].fill(0)
    reach[other].fill(0)
    // A branch the traverser never plays still needs values for its regrets,
    // so a range that cannot reach here is valued as if it held its whole range.
    let ownTotal = 0
    for (let h = 0; h < self.length; h += 1) ownTotal += self[h] as number
    const ownRange = ownTotal > 0 ? self : hands[traverser].weights
    for (let h = 0; h < own.length; h += 1) {
      reach[traverser][own[h] as number] = ownRange[h] as number
    }
    for (let o = 0; o < theirs.length; o += 1) {
      reach[other][theirs[o] as number] = opponent[o] as number
    }
    masses ??= massesFor(hands)
    masses(traverser, opponent, met)
    const ranged = network.checked?.inputs === 'range'
    if (network.checked !== undefined) {
      // The traverser's holdings are read back; the opponent's feed the inputs only.
      table ??= showdownTable(rivers, hands)
      table.won(traverser, opponent, won)
      checked[traverser].fill(0)
      for (let h = 0; h < own.length; h += 1) {
        const meets = met[h] as number
        checked[traverser][own[h] as number] = meets > 0 ? (won[h] as number) / meets : 0
      }
      if (ranged) {
        table.won(other, ownRange, wonOther)
        masses(other, ownRange, metOther)
        checked[other].fill(0)
        for (let o = 0; o < theirs.length; o += 1) {
          const meets = metOther[o] as number
          checked[other][theirs[o] as number] = meets > 0 ? (wonOther[o] as number) / meets : 0
        }
      }
    }
    const values = holdingValues(
      network,
      layout,
      bucketInputs(
        layout,
        [reach[0], reach[1]],
        behind,
        total,
        ranged ? checked : undefined,
        'range',
      ),
      network.checked === undefined ? undefined : checked,
    )[traverser]
    for (let h = 0; h < own.length; h += 1) {
      out[h] = (met[h] as number) * ((values[own[h] as number] as number) * total - mine)
    }
  }
}

type AllInShowdown = (
  traverser: 0 | 1,
  opponent: Float64Array,
  total: number,
  mine: number,
  out: Float64Array,
) => void

/**
 * The showdown after an all-in on the turn, averaged over every river card:
 * a holding's value is the pot times the share it wins, less what it put in,
 * for every opponent holding it can meet. `table` lets a solve that has built
 * the showdown table already share it.
 */
export function allInShowdown(
  rivers: TurnRivers,
  hands: readonly [Hands, Hands],
  table: ShowdownTable = showdownTable(rivers, hands),
): AllInShowdown {
  const masses = massesFor(hands)
  const count = Math.max(hands[0].combos.length, hands[1].combos.length)
  const met = new Float64Array(count)
  const won = new Float64Array(count)
  return (traverser, opponent, total, mine, out) => {
    masses(traverser, opponent, met)
    table.won(traverser, opponent, won)
    for (let h = 0; h < out.length; h += 1) {
      out[h] = (won[h] as number) * total - (met[h] as number) * mine
    }
  }
}

/**
 * What each holding wins at a showdown averaged over every river card, against
 * an opponent's reach: `won(traverser, opponent, out)` puts in `out` each of
 * the traverser's holdings' share of the pot, summed over the opponent
 * holdings it can meet, each weighted by its reach.
 */
export interface ShowdownTable {
  readonly won: (traverser: 0 | 1, opponent: Float64Array, out: Float64Array) => Float64Array
}

/**
 * The showdown table for a solve's holdings. Every pairing of two holdings
 * that share no card leaves 44 river cards, and what each pairing wins on
 * average is worked out once, by comparing the two holdings' ranks on each of
 * those rivers. Each call is then one pass over that table.
 */
export function showdownTable(rivers: TurnRivers, hands: readonly [Hands, Hands]): ShowdownTable {
  const [first, second] = holdingIndices(hands)
  const n = first.length
  const m = second.length
  const cardsOf = (held: Hands, count: number) => {
    const a = new Int32Array(count)
    const b = new Int32Array(count)
    for (let h = 0; h < count; h += 1) {
      a[h] = held.cards[2 * h] as number
      b[h] = held.cards[2 * h + 1] as number
    }
    return [a, b] as const
  }
  const [a0, b0] = cardsOf(hands[0], n)
  const [a1, b1] = cardsOf(hands[1], m)
  // share[h * m + o]: what holding h of player 0 wins against holding o of
  // player 1, a half for a tie, over the rivers they leave; 0 when they clash,
  // since a clashing pairing is never dealt.
  const share = new Float32Array(n * m)
  const clash = new Uint8Array(n * m)
  for (let h = 0; h < n; h += 1) {
    const a = a0[h] as number
    const b = b0[h] as number
    for (let o = 0; o < m; o += 1) {
      const c = a1[o] as number
      const d = b1[o] as number
      if (a === c || a === d || b === c || b === d) clash[h * m + o] = 1
    }
  }
  const theirRank = new Int32Array(m)
  for (const { key, ranks } of rivers.rivers) {
    for (let o = 0; o < m; o += 1) {
      theirRank[o] = a1[o] === key || b1[o] === key ? -1 : (ranks[second[o] as number] as number)
    }
    for (let h = 0; h < n; h += 1) {
      if (a0[h] === key || b0[h] === key) continue
      const mine = ranks[first[h] as number] as number
      const row = h * m
      for (let o = 0; o < m; o += 1) {
        const theirs = theirRank[o] as number
        if (theirs < 0 || clash[row + o] === 1) continue
        share[row + o] =
          (share[row + o] as number) + (mine > theirs ? 1 : mine === theirs ? 0.5 : 0)
      }
    }
  }
  for (let at = 0; at < share.length; at += 1) share[at] = (share[at] as number) / 44
  // The same table seen from player 1, row by row.
  const back = new Float32Array(m * n)
  for (let h = 0; h < n; h += 1) {
    for (let o = 0; o < m; o += 1) {
      if (clash[h * m + o] === 0) back[o * n + h] = 1 - (share[h * m + o] as number)
    }
  }
  const tables = [share, back] as const
  return {
    won(traverser, opponent, out) {
      const table = tables[traverser]
      const width = traverser === 0 ? m : n
      const height = traverser === 0 ? n : m
      for (let h = 0; h < height; h += 1) {
        let won = 0
        const row = h * width
        for (let o = 0; o < width; o += 1) {
          won += (opponent[o] as number) * (table[row + o] as number)
        }
        out[h] = won
      }
      return out
    },
  }
}
