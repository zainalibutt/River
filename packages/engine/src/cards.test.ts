import { describe, expect, it } from 'vitest'
import {
  cardKey,
  cardsToString,
  cardToString,
  makeDeck,
  parseCard,
  RANKS,
  rankValue,
  SUITS,
} from './cards.js'

describe('cards', () => {
  it('builds a 52-card deck with no duplicates', () => {
    const deck = makeDeck()
    expect(deck).toHaveLength(52)
    expect(new Set(deck.map(cardKey)).size).toBe(52)
  })

  it('round-trips card notation', () => {
    const card = parseCard('As')
    expect(cardToString(card)).toBe('As')
    expect(cardsToString([parseCard('Td'), parseCard('5h')])).toBe('Td 5h')
  })

  it('rejects malformed cards', () => {
    expect(() => parseCard('Xx')).toThrow()
    expect(() => parseCard('A')).toThrow()
    expect(() => parseCard('Axx')).toThrow()
  })

  it('maps ranks to values', () => {
    expect(rankValue('2')).toBe(2)
    expect(rankValue('T')).toBe(10)
    expect(rankValue('A')).toBe(14)
    expect(rankValue('Q')).toBe(12)
  })

  it('is built from the canonical rank and suit sets', () => {
    expect(RANKS).toHaveLength(13)
    expect(SUITS).toHaveLength(4)
  })
})
