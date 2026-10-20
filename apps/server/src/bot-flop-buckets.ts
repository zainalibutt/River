import type { Card } from '@river/engine'
import { COMBOS } from './bot-river-value-data.js'
import { turnRivers } from './bot-turn-end-data.js'
import { bucketsFromIds, bucketsFromRanks, type RiverValueNetwork } from './bot-value-network.js'

/** D3 v1: strength percentile x spread of made-hand percentiles over every next card.
 * This is NOT final-runout equity. It uses the same next-card ranks as flop-end data.
 * Variances are rounded to 1e-12 before tie grouping, removing summation-order noise.
 * Both axes use tie midpoints; suit-equivalent holdings must never split arbitrarily.
 */
export function flopBucketIds(
  ranks: Uint16Array,
  nextRanks: readonly Uint16Array[],
  strength = 32,
  potential = 4,
): Uint8Array {
  if (
    ![strength, potential].every((n) => Number.isSafeInteger(n) && n > 0) ||
    strength * potential > 255
  )
    throw new Error('invalid flop bucket dimensions')
  const base = bucketsFromRanks(ranks, strength)
  const sum = new Float64Array(COMBOS)
  const square = new Float64Array(COMBOS)
  const seen = new Uint16Array(COMBOS)
  for (const row of nextRanks) {
    const layout = bucketsFromRanks(row, 1)
    const counts = new Uint16Array(COMBOS + 1)
    for (const rank of row) if (rank > 0) counts[rank] = (counts[rank] as number) + 1
    const middle = new Float64Array(COMBOS + 1)
    let below = 0
    for (let rank = 1; rank <= COMBOS; rank += 1) {
      middle[rank] = (below + (counts[rank] as number) / 2) / layout.live
      below += counts[rank] as number
    }
    for (let h = 0; h < COMBOS; h += 1) {
      if (row[h] === 0) continue
      const p = middle[row[h] as number] as number
      sum[h] = (sum[h] as number) + p
      square[h] = (square[h] as number) + p * p
      seen[h] = (seen[h] as number) + 1
    }
  }
  const spread = new Float64Array(COMBOS)
  for (let h = 0; h < COMBOS; h += 1) {
    if ((base.bucketOf[h] as number) < 0) continue
    const count = seen[h] as number
    if (count === 0) throw new Error('live flop holding has no next cards')
    const mean = (sum[h] as number) / count
    spread[h] = Math.round(Math.max(0, (square[h] as number) / count - mean * mean) * 1e12)
  }
  const ids = new Uint8Array(COMBOS).fill(255)
  for (let s = 0; s < strength; s += 1) {
    const members = Array.from({ length: COMBOS }, (_, h) => h)
      .filter((h) => base.bucketOf[h] === s)
      .sort((a, b) => (spread[a] as number) - (spread[b] as number))
    for (let start = 0; start < members.length; ) {
      let end = start + 1
      while (
        end < members.length &&
        spread[members[end] as number] === spread[members[start] as number]
      )
        end += 1
      const p = Math.min(
        Math.floor(((start + end) / 2 / members.length) * potential),
        potential - 1,
      )
      for (let i = start; i < end; i += 1) ids[members[i] as number] = s * potential + p
      start = end
    }
  }
  return ids
}

export function flopLayout(board: readonly Card[], ranks: Uint16Array, network: RiverValueNetwork) {
  if (board.length !== 3) throw new Error('flop layout requires three board cards')
  if (network.turnBuckets !== undefined)
    throw new Error('turn bucket exports are not flop networks')
  return network.flopBuckets === undefined
    ? bucketsFromRanks(ranks, network.buckets)
    : bucketsFromIds(
        flopBucketIds(
          ranks,
          turnRivers(board).rivers.map((r) => r.ranks),
          network.flopBuckets.strength,
          network.flopBuckets.potential,
        ),
        network.buckets,
      )
}
