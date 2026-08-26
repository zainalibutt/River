import { describe, expect, it } from 'vitest'
import { type Card, parseCard } from './cards.js'
import { compareRanks, evaluateBest } from './evaluator.js'
import { beats, kickerMattered, nameHand, shortName } from './hand-strength.js'

const cards = (...texts: string[]): Card[] => texts.map(parseCard)

const ROYAL = cards('As', 'Ks', 'Qs', 'Js', 'Ts')
const STRAIGHT_FLUSH = cards('9h', '8h', '7h', '6h', '5h')
const QUADS = cards('Ah', 'Ad', 'As', 'Ac', 'Kd')
const FULL_HOUSE = cards('Ah', 'Ad', 'As', 'Kh', 'Kd')
const FLUSH = cards('As', 'Ks', 'Qs', 'Js', '9s')
const STRAIGHT = cards('9h', '8d', '7c', '6s', '5h')
const WHEEL = cards('Ah', '2d', '3c', '4s', '5h')
const TRIPS = cards('7h', '7d', '7c', 'Ah', 'Kd')
const TWO_PAIR = cards('Kh', 'Kd', '8c', '8s', 'Ah')
const PAIR = cards('Qh', 'Qd', 'Ah', 'Kd', 'Jc')
const HIGH_CARD = cards('Ah', 'Kd', 'Qc', 'Js', '9h')

describe('nameHand', () => {
  const cases: Array<[Card[], string]> = [
    [ROYAL, 'Royal flush'],
    [STRAIGHT_FLUSH, 'Nine-high straight flush'],
    [QUADS, 'Quad aces'],
    [FULL_HOUSE, 'Aces full of kings'],
    [FLUSH, 'Flush, ace high'],
    [STRAIGHT, 'Nine-high straight'],
    [TRIPS, 'Trip sevens'],
    [TWO_PAIR, 'Two pair, kings and eights'],
    [PAIR, 'Pair of queens'],
    [HIGH_CARD, 'Ace high'],
  ]
  for (const [hand, expected] of cases) {
    it(`names ${expected}`, () => {
      expect(nameHand(evaluateBest(hand))).toBe(expected)
    })
  }

  it('names a wheel as five-high, not ace high', () => {
    expect(nameHand(evaluateBest(WHEEL))).toBe('Five-high straight')
  })

  it('is deterministic when naming the same rank twice', () => {
    const rank = evaluateBest(FULL_HOUSE)
    expect(nameHand(rank)).toBe(nameHand(rank))
  })
})

describe('shortName', () => {
  const ranks = [
    ROYAL,
    STRAIGHT_FLUSH,
    QUADS,
    FULL_HOUSE,
    FLUSH,
    STRAIGHT,
    TRIPS,
    TWO_PAIR,
    PAIR,
    HIGH_CARD,
  ].map(evaluateBest)
  it('stays under 16 characters for all nine categories', () => {
    for (const rank of ranks) {
      expect(shortName(rank).length).toBeLessThan(16)
    }
  })

  it('produces the documented phrases', () => {
    expect(shortName(evaluateBest(TWO_PAIR))).toBe('Two pair, K8')
    expect(shortName(evaluateBest(FULL_HOUSE))).toBe('Aces full')
    expect(shortName(evaluateBest(STRAIGHT))).toBe('9-high str8')
    expect(shortName(evaluateBest(TRIPS))).toBe('Trip 7s')
    expect(shortName(evaluateBest(HIGH_CARD))).toBe('Ace high')
  })
})

describe('beats', () => {
  it('returns tie for two identical ranks', () => {
    const a = evaluateBest(PAIR)
    const b = evaluateBest(PAIR)
    expect(beats(a, b)).toBe('tie')
  })

  it('agrees with compareRanks across 200 seeded pseudo-random pairings', () => {
    const state = new Seeded(0x9e3779b9)
    for (let n = 0; n < 200; n += 1) {
      const a = evaluateBest(randomSeven(state))
      const b = evaluateBest(randomSeven(state))
      const comparison = compareRanks(a, b)
      const expected = comparison > 0 ? 'a' : comparison < 0 ? 'b' : 'tie'
      expect(beats(a, b)).toBe(expected)
    }
  })

  it('returns a when a beats b and b when b beats a', () => {
    expect(beats(evaluateBest(STRAIGHT), evaluateBest(PAIR))).toBe('a')
    expect(beats(evaluateBest(PAIR), evaluateBest(STRAIGHT))).toBe('b')
  })
})

describe('kickerMattered', () => {
  it('is true for AK against AQ on a shared board', () => {
    const board = cards('2d', '5c', '7d', 'Ts', 'Jc')
    const ak = evaluateBest([...board, ...cards('Ah', 'Kd')])
    const aq = evaluateBest([...board, ...cards('Ah', 'Qs')])
    expect(kickerMattered(ak, aq)).toBe(true)
  })

  it('is false when the categories differ', () => {
    expect(kickerMattered(evaluateBest(TWO_PAIR), evaluateBest(HIGH_CARD))).toBe(false)
  })

  it('is false when the primary rank decides it, not a kicker', () => {
    const pairKings = evaluateBest(cards('Kh', 'Kd', 'Jc', '9s', '7h'))
    const pairQueens = evaluateBest(cards('Qh', 'Qd', 'Jc', '9s', '7h'))
    expect(kickerMattered(pairKings, pairQueens)).toBe(false)
  })

  it('is true when a full house splits on the pair after equal trips', () => {
    const a = evaluateBest(cards('Ah', 'Ad', 'As', 'Kh', 'Kd'))
    const b = evaluateBest(cards('Ah', 'Ad', 'As', 'Qh', 'Qd'))
    expect(kickerMattered(a, b)).toBe(true)
  })
})

function randomSeven(rng: Seeded): Card[] {
  const deck = makeDeck()
  const chosen: Card[] = []
  for (let i = 0; i < 7; i += 1) {
    const index = rng.next() % deck.length
    chosen.push(deck[index] as Card)
    deck.splice(index, 1)
  }
  return chosen
}

function makeDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of ['s', 'h', 'd', 'c']) {
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']) {
      deck.push({ rank: rank as Card['rank'], suit: suit as Card['suit'] })
    }
  }
  return deck
}

class Seeded {
  private state: number
  constructor(seed: number) {
    this.state = seed
  }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) % 4294967296
    return this.state
  }
}
