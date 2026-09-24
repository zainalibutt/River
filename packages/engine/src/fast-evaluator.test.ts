import { describe, expect, it } from 'vitest'
import { makeDeck, parseCard } from './cards.js'
import { compareRanks, evaluateBest, HandCategory } from './evaluator.js'
import { categoryOfScore, handScore } from './fast-evaluator.js'
import { mulberry32 } from './rng.js'

const cards = (text: string) => text.split(' ').map(parseCard)

describe('fast hand score', () => {
  it('orders random hands exactly as evaluateBest does, for five to seven cards', () => {
    const random = mulberry32(20260924)
    const deck = makeDeck()
    const draw = (size: number) => {
      const pool = [...deck]
      for (let index = pool.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1))
        ;[pool[index], pool[swap]] = [
          pool[swap] as (typeof pool)[number],
          pool[index] as (typeof pool)[number],
        ]
      }
      return pool.slice(0, size)
    }
    let checked = 0
    for (let trial = 0; trial < 8_000; trial += 1) {
      const size = 5 + (trial % 3)
      const a = draw(size)
      const b = draw(size)
      expect(categoryOfScore(handScore(a))).toBe(evaluateBest(a).category)
      expect(Math.sign(handScore(a) - handScore(b))).toBe(
        Math.sign(compareRanks(evaluateBest(a), evaluateBest(b))),
      )
      checked += 1
    }
    expect(checked).toBe(8_000)
  }, 30_000)

  it('handles the edge cases a bitmask evaluator gets wrong', () => {
    expect(categoryOfScore(handScore(cards('Ah 2d 3c 4s 5h 9d Kc')))).toBe(HandCategory.STRAIGHT)
    expect(handScore(cards('Ah 2d 3c 4s 5h 9d Kc'))).toBeLessThan(
      handScore(cards('2h 3d 4c 5s 6h 9d Kc')),
    )
    expect(categoryOfScore(handScore(cards('Ah 2h 3h 4h 5h 9d Kc')))).toBe(
      HandCategory.STRAIGHT_FLUSH,
    )
    expect(categoryOfScore(handScore(cards('Kh Kd Kc 9s 9h 9d 2c')))).toBe(HandCategory.FULL_HOUSE)
    expect(handScore(cards('Kh Kd Kc 9s 9h 9d 2c'))).toBeGreaterThan(
      handScore(cards('Kh Kd Kc 8s 8h 2d 3c')),
    )
    expect(handScore(cards('Ah Ad Kc Ks Qh Qd 2c'))).toBe(handScore(cards('As Ac Kh Kd Qs Qc 3c')))
  })
})
