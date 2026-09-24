import { describe, expect, it } from 'vitest'
import { boardTexture } from './board-texture.js'
import { parseCard } from './cards.js'

const board = (cards: string) => cards.split(' ').filter(Boolean).map(parseCard)

describe('boardTexture', () => {
  it.each([
    ['Ah 8c 3s', 3, 'unpaired', 1, 2],
    ['Jh Th 4s', 3, 'unpaired', 2, 2],
    ['Ks Kd 2h', 2, 'one-pair', 1, 1],
    ['As 2d 3c 4h', 4, 'unpaired', 1, 4],
  ] as const)(
    'describes %s from public cards',
    (cards, distinctRanks, rankPattern, maxSameSuit, maxStraightWindowRanks) => {
      expect(boardTexture(board(cards))).toMatchObject({
        cardCount: cards.split(' ').length,
        distinctRanks,
        rankPattern,
        maxSameSuit,
        maxStraightWindowRanks,
      })
    },
  )

  it.each([
    ['As Ac 2d', 'one-pair', [2, 1], 2],
    ['As Ac 2d 2c 3h', 'two-pair', [2, 2, 1], 3],
    ['As Ac Ad 2c', 'trips', [3, 1], 2],
    ['As Ac Ad 2c 2d', 'full-house', [3, 2], 2],
    ['As Ac Ad Ah 2d', 'quads', [4, 1], 2],
  ] as const)(
    'counts duplicate ranks on %s',
    (cards, rankPattern, rankMultiplicities, maxStraightWindowRanks) => {
      expect(boardTexture(board(cards))).toMatchObject({
        rankPattern,
        rankMultiplicities,
        maxStraightWindowRanks,
      })
    },
  )

  it('counts ace low without wrapping other high ranks', () => {
    expect(boardTexture(board('As 2d 3c 4h 5s')).maxStraightWindowRanks).toBe(5)
    expect(boardTexture(board('Ks As 2d 3c 4h')).maxStraightWindowRanks).toBe(4)
    expect(boardTexture(board('Ks As 2d')).maxStraightWindowRanks).toBe(2)
  })

  it('has zero features on an empty board and does not change its input', () => {
    const cards = board('Jh Th 4s')
    const before = structuredClone(cards)
    expect(boardTexture([])).toEqual({
      cardCount: 0,
      distinctRanks: 0,
      rankPattern: 'unpaired',
      rankMultiplicities: [],
      maxSameSuit: 0,
      maxStraightWindowRanks: 0,
    })
    boardTexture(cards)
    expect(cards).toEqual(before)
  })
})
