import { describe, expect, it } from 'vitest'
import { hasDraw, holdingOf } from './bot-holding.js'
import { parseCard } from './cards.js'

const cards = (text: string) => text.split(' ').map(parseCard)

describe('what the actor holds beyond the board', () => {
  it('counts a board pair as nobody’s pair', () => {
    const board = cards('Kh 9d 5c 2s 3h')
    expect(holdingOf(cards('Qs Jc'), board)).toBe('air')
    expect(holdingOf(cards('Ks 7c'), board)).toBe('pair')
    expect(holdingOf(cards('Ks 9c'), board)).toBe('strong')
    const paired = cards('7h 7d 5c 2s 3h')
    expect(holdingOf(cards('Qs Jc'), paired)).toBe('air')
    expect(holdingOf(cards('Qs Qc'), paired)).toBe('pair')
    expect(holdingOf(cards('7s Qc'), paired)).toBe('strong')
  })

  it('finds flush and open-ended straight draws before the river only', () => {
    expect(holdingOf(cards('Ah 4h'), cards('Kh 9h 2c'))).toBe('draw')
    expect(holdingOf(cards('9s 8c'), cards('7d 6h 2c'))).toBe('draw')
    expect(hasDraw(cards('9s 8c'), cards('7d 6h 2c Kd'))).toBe(true)
    expect(hasDraw(cards('9s 8c'), cards('7d 6h 2c Kd Qs'))).toBe(false)
    expect(hasDraw(cards('As Kc'), cards('Qd Jh 2c'))).toBe(false)
    expect(hasDraw(cards('2s 3c'), cards('Qd Jh Tc 9d'))).toBe(false)
  })

  it('refuses to classify a hand before the flop', () => {
    expect(() => holdingOf(cards('As Kc'), [])).toThrow()
  })
})
