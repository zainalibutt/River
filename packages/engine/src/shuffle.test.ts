import { describe, expect, it } from 'vitest'
import { cardKey, makeDeck } from './cards.js'
import { mulberry32 } from './rng.js'
import { deal, shuffle } from './shuffle.js'

describe('shuffle', () => {
  it('keeps all 52 unique cards', () => {
    const deck = shuffle(makeDeck(), mulberry32(7))
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map(cardKey)).size).toBe(52)
  })

  it('is deterministic for a seed', () => {
    const a = shuffle(makeDeck(), mulberry32(99))
    const b = shuffle(makeDeck(), mulberry32(99))
    expect(a.map(cardKey)).toEqual(b.map(cardKey))
  })

  it('is not identical to the unshuffled order', () => {
    const deck = shuffle(makeDeck(), mulberry32(1))
    expect(deck.map(cardKey)).not.toEqual(makeDeck().map(cardKey))
  })
})

describe('deal', () => {
  it('splits a prefix off the deck', () => {
    const deck = makeDeck()
    const { hand, rest } = deal(deck, 2)
    expect(hand).toHaveLength(2)
    expect(rest).toHaveLength(50)
    expect(rest[0]).toBe(deck[2])
  })
})
