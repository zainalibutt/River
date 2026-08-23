export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Suit = (typeof SUITS)[number]

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export type Rank = (typeof RANKS)[number]

export interface Card {
  rank: Rank
  suit: Suit
}

export function makeDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
}

export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2
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
  return SUITS.indexOf(card.suit) * 13 + RANKS.indexOf(card.rank)
}
