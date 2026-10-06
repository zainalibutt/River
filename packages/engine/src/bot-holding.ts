import { boardTexture } from './board-texture.js'
import { type Card, rankValue } from './cards.js'
import { evaluateBest, HandCategory } from './evaluator.js'

export type Holding = 'air' | 'draw' | 'pair' | 'strong'

/**
 * What the actor holds beyond what the board already gives everybody.
 *
 * A pair on the board is nobody's pair, so it counts as air; two pair made
 * from one board pair counts as a pair. A draw is four to a flush with a hole
 * card in it, or four consecutive ranks with a hole card in them and room at
 * both ends, and only before the river.
 */
export function holdingOf(hole: readonly Card[], board: readonly Card[]): Holding {
  if (board.length < 3) throw new Error('a holding needs a flop')
  const category = evaluateBest([...hole, ...board]).category
  const boardCategory = board.length === 5 ? evaluateBest(board).category : boardOnly(board)
  if (category > boardCategory) {
    const onePairFromBoard =
      category === HandCategory.TWO_PAIR && boardCategory === HandCategory.PAIR
    return category >= HandCategory.TWO_PAIR && !onePairFromBoard ? 'strong' : 'pair'
  }
  return hasDraw(hole, board) ? 'draw' : 'air'
}

export function hasDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length < 3 || board.length > 4) return false
  const visible = [...hole, ...board]
  for (const card of hole) {
    if (visible.filter((other) => other.suit === card.suit).length === 4) return true
  }
  const ranks = new Set(visible.map((card) => rankValue(card.rank)))
  const holeRanks = new Set(hole.map((card) => rankValue(card.rank)))
  for (let low = 2; low <= 10; low += 1) {
    const window = [low, low + 1, low + 2, low + 3]
    if (window.every((rank) => ranks.has(rank)) && window.some((rank) => holeRanks.has(rank))) {
      if (!ranks.has(low - 1) && !ranks.has(low + 4)) return true
    }
  }
  return false
}

function boardOnly(board: readonly Card[]): HandCategory {
  const pattern = boardTexture(board).rankPattern
  if (pattern === 'one-pair') return HandCategory.PAIR
  if (pattern === 'two-pair') return HandCategory.TWO_PAIR
  if (pattern === 'trips') return HandCategory.THREE_OF_A_KIND
  if (pattern === 'full-house') return HandCategory.FULL_HOUSE
  if (pattern === 'quads') return HandCategory.FOUR_OF_A_KIND
  return HandCategory.HIGH_CARD
}
