import { type Card, rankValue } from './cards.js'
import { HandCategory } from './evaluator.js'

const SUIT_INDEX: Readonly<Record<string, number>> = { s: 0, h: 1, d: 2, c: 3 }
const CATEGORY_WEIGHT = 16 ** 5

/**
 * A single comparable number for the best five-card hand in five to seven
 * cards: higher wins, equal ties.
 *
 * It orders hands exactly as `evaluateBest` with `compareRanks` does (the
 * parity test checks that on random hands), without building the 21 five-card
 * subsets, which is what made equity estimates cost tens of milliseconds.
 */
export function handScore(cards: readonly Card[]): number {
  const counts = new Array<number>(15).fill(0)
  const suitMasks = [0, 0, 0, 0]
  const suitCounts = [0, 0, 0, 0]
  let mask = 0
  for (const card of cards) {
    const rank = rankValue(card.rank)
    const suit = SUIT_INDEX[card.suit] as number
    counts[rank] = (counts[rank] ?? 0) + 1
    suitMasks[suit] = (suitMasks[suit] as number) | (1 << rank)
    suitCounts[suit] = (suitCounts[suit] as number) + 1
    mask |= 1 << rank
  }
  for (let suit = 0; suit < 4; suit += 1) {
    if ((suitCounts[suit] as number) >= 5) {
      const flushMask = suitMasks[suit] as number
      const straightFlush = straightTop(flushMask)
      if (straightFlush > 0) return score(HandCategory.STRAIGHT_FLUSH, [straightFlush])
      return score(HandCategory.FLUSH, topRanks(flushMask, 5))
    }
  }
  const quads: number[] = []
  const trips: number[] = []
  const pairs: number[] = []
  for (let rank = 14; rank >= 2; rank -= 1) {
    const count = counts[rank] as number
    if (count === 4) quads.push(rank)
    else if (count === 3) trips.push(rank)
    else if (count === 2) pairs.push(rank)
  }
  if (quads.length > 0) {
    const quad = quads[0] as number
    return score(HandCategory.FOUR_OF_A_KIND, [quad, highestExcept(mask, [quad])])
  }
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const top = trips[0] as number
    const pair = Math.max(trips[1] ?? 0, pairs[0] ?? 0)
    return score(HandCategory.FULL_HOUSE, [top, pair])
  }
  const straight = straightTop(mask)
  if (straight > 0) return score(HandCategory.STRAIGHT, [straight])
  if (trips.length > 0) {
    const trip = trips[0] as number
    return score(HandCategory.THREE_OF_A_KIND, [trip, ...topRanks(mask & ~(1 << trip), 2)])
  }
  if (pairs.length >= 2) {
    const [high, low] = pairs as [number, number]
    return score(HandCategory.TWO_PAIR, [high, low, highestExcept(mask, [high, low])])
  }
  if (pairs.length === 1) {
    const pair = pairs[0] as number
    return score(HandCategory.PAIR, [pair, ...topRanks(mask & ~(1 << pair), 3)])
  }
  return score(HandCategory.HIGH_CARD, topRanks(mask, 5))
}

export function categoryOfScore(value: number): HandCategory {
  return Math.floor(value / CATEGORY_WEIGHT) as HandCategory
}

function score(category: HandCategory, ranks: readonly number[]): number {
  let value = category
  for (let index = 0; index < 5; index += 1) value = value * 16 + (ranks[index] ?? 0)
  return value
}

function straightTop(mask: number): number {
  const withWheel = mask & (1 << 14) ? mask | (1 << 1) : mask
  for (let high = 14; high >= 5; high -= 1) {
    const run = 0b11111 << (high - 4)
    if ((withWheel & run) === run) return high
  }
  return 0
}

function topRanks(mask: number, count: number): number[] {
  const ranks: number[] = []
  for (let rank = 14; rank >= 2 && ranks.length < count; rank -= 1) {
    if (mask & (1 << rank)) ranks.push(rank)
  }
  return ranks
}

function highestExcept(mask: number, excluded: readonly number[]): number {
  for (let rank = 14; rank >= 2; rank -= 1) {
    if (mask & (1 << rank) && !excluded.includes(rank)) return rank
  }
  return 0
}
