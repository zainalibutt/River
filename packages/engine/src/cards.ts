export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Suit = (typeof SUITS)[number]

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = (typeof RANKS)[number]

export interface Card {
  rank: Rank
  suit: Suit
}

/** Each suit's first key and each rank's place, looked up instead of searched for. */
const SUIT_OFFSET: Readonly<Record<string, number>> = Object.fromEntries(
  SUITS.map((suit, index) => [suit, index * 13]),
)
const RANK_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  RANKS.map((rank, index) => [rank, index]),
)

export function makeDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
}

export function rankValue(rank: Rank): number {
  return (RANK_INDEX[rank] ?? -1) + 2
}

export function parseCard(text: string): Card {
  const rank = RANKS.find((r) => text[0] === r)
  const suit = SUITS.find((s) => text[1] === s)
  if (rank === undefined || suit === undefined || text.length !== 2) {
    throw new Error(`invalid card: ${text}`)
  }
  return { rank, suit }
}

export function cardToString(card: Card): string {
  return card.rank + card.suit
}

export function cardsToString(cards: readonly Card[]): string {
  return cards.map(cardToString).join(' ')
}

export function cardKey(card: Card): number {
  return (SUIT_OFFSET[card.suit] ?? -13) + (RANK_INDEX[card.rank] ?? -1)
}
