import type { Rng } from './rng.js'

function at<T>(items: readonly T[], index: number): T {
  const value = items[index]
  if (value === undefined) {
    throw new Error(`no element at index ${index} in array of length ${items.length}`)
  }
  return value
}

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
