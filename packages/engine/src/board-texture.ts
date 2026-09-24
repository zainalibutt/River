import { type Card, rankValue, SUITS } from './cards.js'

export type BoardRankPattern =
  | 'unpaired'
  | 'one-pair'
  | 'two-pair'
  | 'trips'
  | 'full-house'
  | 'quads'

export interface BoardTexture {
  cardCount: number
  distinctRanks: number
  rankPattern: BoardRankPattern
  rankMultiplicities: readonly number[]
  maxSameSuit: number
  maxStraightWindowRanks: number
}

export function boardTexture(board: readonly Card[]): BoardTexture {
  const ranks = board.map((card) => rankValue(card.rank))
  const distinct = new Set(ranks)
  const counts = new Map<number, number>()
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1)
  const rankMultiplicities = [...counts.values()].sort((a, b) => b - a)

  let rankPattern: BoardRankPattern = 'unpaired'
  if (rankMultiplicities[0] === 4) rankPattern = 'quads'
  else if (rankMultiplicities[0] === 3 && rankMultiplicities[1] === 2) rankPattern = 'full-house'
  else if (rankMultiplicities[0] === 3) rankPattern = 'trips'
  else if (rankMultiplicities[0] === 2 && rankMultiplicities[1] === 2) rankPattern = 'two-pair'
  else if (rankMultiplicities[0] === 2) rankPattern = 'one-pair'

  const maxSameSuit = Math.max(
    0,
    ...SUITS.map((suit) => board.filter((card) => card.suit === suit).length),
  )
  let maxStraightWindowRanks = 0
  for (let high = 6; high <= 14; high++) {
    let inWindow = 0
    for (let rank = high - 4; rank <= high; rank++) {
      if (distinct.has(rank)) inWindow++
    }
    maxStraightWindowRanks = Math.max(maxStraightWindowRanks, inWindow)
  }
  const wheelRanks = [14, 2, 3, 4, 5]
  maxStraightWindowRanks = Math.max(
    maxStraightWindowRanks,
    wheelRanks.filter((rank) => distinct.has(rank)).length,
  )

  return {
    cardCount: board.length,
    distinctRanks: distinct.size,
    rankPattern,
    rankMultiplicities,
    maxSameSuit,
    maxStraightWindowRanks,
  }
}
