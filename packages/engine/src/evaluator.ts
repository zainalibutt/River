import type { Card } from './cards.js'
import { rankValue } from './cards.js'
import { at, combinations } from './util.js'

export enum HandCategory {
  HIGH_CARD,
  PAIR,
  TWO_PAIR,
  THREE_OF_A_KIND,
  STRAIGHT,
  FLUSH,
  FULL_HOUSE,
  FOUR_OF_A_KIND,
  STRAIGHT_FLUSH,
}

export interface HandRank {
  category: HandCategory
  ranks: number[]
  cards: Card[]
}

const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const

function sortDesc(values: number[]): number[] {
  return [...values].sort((a, b) => b - a)
}

function straightHigh(ranks: number[]): number | null {
  const distinct = new Set(ranks)
  if (distinct.size !== 5) return null
  const high = Math.max(...distinct)
  const low = Math.min(...distinct)
  if (high - low === 4) return high
  if (high === 14 && low === 2 && [2, 3, 4, 5].every((rank) => distinct.has(rank))) return 5
  return null
}

export function evaluateRanks(ranks: number[], suits: string[]): HandRank {
  if (ranks.length !== 5 || suits.length !== 5) {
    throw new Error(`evaluateRanks expects five cards, got ${ranks.length}`)
  }
  const countByRank = new Map<number, number>()
  for (const rank of ranks) {
    countByRank.set(rank, (countByRank.get(rank) ?? 0) + 1)
  }
  const groups = [...countByRank.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const pattern = groups.map((g) => g[1]).join(',')
  const rankAt = (index: number): number => at(groups, index)[0]
  const isFlush = new Set(suits).size === 1
  const straight = straightHigh(ranks)
  switch (pattern) {
    case '4,1':
      return { category: HandCategory.FOUR_OF_A_KIND, ranks: [rankAt(0), rankAt(1)], cards: [] }
    case '3,2':
      return { category: HandCategory.FULL_HOUSE, ranks: [rankAt(0), rankAt(1)], cards: [] }
    case '3,1,1':
      return {
        category: HandCategory.THREE_OF_A_KIND,
        ranks: [rankAt(0), rankAt(1), rankAt(2)],
        cards: [],
      }
    case '2,2,1':
      return {
        category: HandCategory.TWO_PAIR,
        ranks: [rankAt(0), rankAt(1), rankAt(2)],
        cards: [],
      }
    case '2,1,1,1':
      return {
        category: HandCategory.PAIR,
        ranks: [rankAt(0), rankAt(1), rankAt(2), rankAt(3)],
        cards: [],
      }
    default: {
      if (isFlush && straight !== null) {
        return { category: HandCategory.STRAIGHT_FLUSH, ranks: [straight], cards: [] }
      }
      if (straight !== null) {
        return { category: HandCategory.STRAIGHT, ranks: [straight], cards: [] }
      }
      if (isFlush) {
        return { category: HandCategory.FLUSH, ranks: sortDesc(ranks), cards: [] }
      }
      return { category: HandCategory.HIGH_CARD, ranks: sortDesc(ranks), cards: [] }
    }
  }
}

export function evaluateBest(cards: readonly Card[]): HandRank {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluateBest supports five to seven cards, got ${cards.length}`)
  }
  let best: { rank: HandRank; chosen: Card[] } | null = null
  for (const combo of combinations(cards, 5)) {
    const rank = evaluateRanks(
      combo.map((c) => rankValue(c.rank)),
      combo.map((c) => c.suit),
    )
    if (best === null || compareRanks(rank, best.rank) > 0) {
      best = { rank, chosen: combo }
    }
  }
  if (best === null) {
    throw new Error('evaluateBest needs at least five cards')
  }
  return { ...best.rank, cards: best.chosen }
}

export function compareRanks(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category
  for (let i = 0; i < a.ranks.length; i++) {
    const diff = at(a.ranks, i) - at(b.ranks, i)
    if (diff !== 0) return diff
  }
  return 0
}

export function describeHand(rank: HandRank): string {
  const name = CATEGORY_NAMES[rank.category] ?? 'Unknown'
  if (rank.category === HandCategory.STRAIGHT_FLUSH && at(rank.ranks, 0) === 14) {
    return 'Royal flush'
  }
  return name
}
