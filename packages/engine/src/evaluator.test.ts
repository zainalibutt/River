import { describe, expect, it } from 'vitest'
import type { Card } from './cards.js'
import { makeDeck, parseCard } from './cards.js'
import { compareRanks, describeHand, evaluateBest, HandCategory } from './evaluator.js'

function bestOf(text: string): ReturnType<typeof evaluateBest> {
  return evaluateBest(text.split(' ').map(parseCard))
}

describe('evaluator known hands', () => {
  it('ranks a royal flush above a lower straight flush', () => {
    const royal = bestOf('As Ks Qs Js Ts')
    const lower = bestOf('Ks Qs Js Ts 9s')
    expect(describeHand(royal)).toBe('Royal flush')
    expect(compareRanks(royal, lower)).toBeGreaterThan(0)
  })

  it('recognises the wheel as the lowest straight', () => {
    const wheel = bestOf('As 2s 3s 4h 5d')
    const sixHigh = bestOf('6s 2s 3s 4h 5d')
    expect(wheel.category).toBe(HandCategory.STRAIGHT)
    expect(compareRanks(sixHigh, wheel)).toBeGreaterThan(0)
  })

  it('splits identical hands', () => {
    const a = bestOf('As Ks Qs Js Ts')
    const b = bestOf('Ah Kh Qh Jh Th')
    expect(compareRanks(a, b)).toBe(0)
  })

  it('ranks quads over a full house', () => {
    const quads = bestOf('As Ac Ad Ah Kd')
    const boat = bestOf('Ks Kc Kd Qh Qs')
    expect(compareRanks(quads, boat)).toBeGreaterThan(0)
  })

  it('ranks a flush over a straight', () => {
    const flush = bestOf('As 7s 5s 3s 2s')
    const straight = bestOf('9s 8h 7d 6c 5s')
    expect(compareRanks(flush, straight)).toBeGreaterThan(0)
  })

  it('breaks two-pair ties by kicker', () => {
    const higherKicker = bestOf('As Ac Kd Kh 3s')
    const lowerKicker = bestOf('As Ac Kd Kh 2s')
    expect(compareRanks(higherKicker, lowerKicker)).toBeGreaterThan(0)
  })

  it('compares pair kickers', () => {
    const queenKicker = bestOf('As Ad Qh 7c 2d')
    const jackKicker = bestOf('Ac Ah Jh 8c 3d')
    expect(compareRanks(queenKicker, jackKicker)).toBeGreaterThan(0)
  })

  it('detects a full house pattern', () => {
    const boat = bestOf('9s 9c 9d 4h 4s')
    expect(boat.category).toBe(HandCategory.FULL_HOUSE)
  })
})

describe('evaluator best five of seven', () => {
  it('plays the board when the board beats the hole pair', () => {
    const seven = bestOf('2c 2d As Ad Qh 7c 5s')
    expect(seven.category).toBe(HandCategory.TWO_PAIR)
    expect(seven.cards).toHaveLength(5)
  })

  it('finds the best flush from suited cards', () => {
    const seven = bestOf('Ac 3c Kc 9c 8c As 2d')
    expect(seven.category).toBe(HandCategory.FLUSH)
  })

  it('keeps a straight over a pair from seven cards', () => {
    const seven = bestOf('9c 9d 6s 7h 8s Ts Js')
    expect(seven.category).toBe(HandCategory.STRAIGHT)
  })
})

describe('evaluator exhaustive five-card distribution', () => {
  it('matches known poker combinatorics', () => {
    const deck = makeDeck()
    const counts = new Array(9).fill(0)
    for (let a = 0; a < 48; a++) {
      for (let b = a + 1; b < 49; b++) {
        for (let c = b + 1; c < 50; c++) {
          for (let d = c + 1; d < 51; d++) {
            for (let e = d + 1; e < 52; e++) {
              const cards = [deck[a], deck[b], deck[c], deck[d], deck[e]].filter(
                (card): card is Card => card !== undefined,
              )
              const rank = evaluateBest(cards)
              counts[rank.category]++
            }
          }
        }
      }
    }
    expect(counts[HandCategory.STRAIGHT_FLUSH]).toBe(40)
    expect(counts[HandCategory.FOUR_OF_A_KIND]).toBe(624)
    expect(counts[HandCategory.FULL_HOUSE]).toBe(3744)
    expect(counts[HandCategory.FLUSH]).toBe(5108)
    expect(counts[HandCategory.STRAIGHT]).toBe(10200)
    expect(counts[HandCategory.THREE_OF_A_KIND]).toBe(54912)
    expect(counts[HandCategory.TWO_PAIR]).toBe(123552)
    expect(counts[HandCategory.PAIR]).toBe(1098240)
    expect(counts[HandCategory.HIGH_CARD]).toBe(1302540)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2598960)
  }, 120_000)
})
