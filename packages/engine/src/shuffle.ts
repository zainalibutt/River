import type { Rng } from './rng.js'
import { at } from './util.js'

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const deck = [...items]
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const current = at(deck, i)
    deck[i] = at(deck, j)
    deck[j] = current
  }
  return deck
}

export function deal<T>(deck: readonly T[], count: number): { hand: T[]; rest: T[] } {
  const hand = deck.slice(0, count)
  return { hand, rest: deck.slice(count) }
}
