import { describe, expect, it } from 'vitest'
import { BettingError, BettingHand } from './betting.js'

function hand(stacks: number[], dealer: number, seats?: string[]): BettingHand {
  const ids = seats ?? stacks.map((_, i) => `p${i}`)
  return new BettingHand({
    seats: stacks.map((stack, i) => ({ id: ids[i] ?? `p${i}`, stack })),
    dealerIndex: dealer,
    smallBlind: 10,
    bigBlind: 20,
  })
}

function totals(betting: BettingHand): Record<string, number> {
  return Object.fromEntries(betting.players.map((p) => [p.id, p.betThisHand]))
}

describe('betting heads-up', () => {
  it('posts blinds with the button as small blind', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    expect(totals(betting)).toEqual({ a: 10, b: 20 })
    expect(betting.players[0]?.stack).toBe(990)
    expect(betting.players[1]?.stack).toBe(980)
    expect(betting.toActId).toBe('b')
    expect(betting.betToCall('b')).toBe(0)
  })

  it('lets the big blind check the option, then the button acts preflop', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    expect(betting.toActId).toBe('a')
    expect(betting.betToCall('a')).toBe(10)
    betting.call('a')
    expect(betting.street).toBe('flop')
    expect(betting.toActId).toBe('b')
    expect(betting.players[0]?.betThisStreet).toBe(0)
    expect(betting.players[1]?.betThisStreet).toBe(0)
  })

  it('rotates the button so roles swap', () => {
    const first = hand([1000, 1000], 0, ['a', 'b'])
    expect(totals(first)).toEqual({ a: 10, b: 20 })
    const second = hand([1000, 1000], 1, ['a', 'b'])
    expect(totals(second)).toEqual({ a: 20, b: 10 })
    expect(second.toActId).toBe('a')
  })
})

describe('betting raises', () => {
  it('enforces a minimum bet of the big blind postflop', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    betting.call('a')
    expect(betting.street).toBe('flop')
    expect(() => betting.raiseTo('b', 15)).toThrow(BettingError)
    betting.raiseTo('b', 500)
    expect(betting.minRaiseTo()).toBe(1000)
  })

  it('sizes the next minimum raise from the previous raise', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    betting.raiseTo('a', 60)
    expect(betting.minRaiseTo()).toBe(100)
    expect(() => betting.raiseTo('b', 99)).toThrow(BettingError)
    betting.raiseTo('b', 100)
    expect(betting.minRaiseTo()).toBe(140)
  })

  it('allows uncapped raises as long as the stack covers them', () => {
    const betting = hand([5000, 5000], 0, ['a', 'b'])
    betting.check('b')
    betting.raiseTo('a', 200)
    betting.raiseTo('b', 2000)
    betting.raiseTo('a', 4500)
    expect(() => betting.raiseTo('b', 6000)).toThrow(BettingError)
  })

  it('reopens betting for players who already acted after a full raise', () => {
    const betting = hand([1000, 1000, 1000], 2, ['a', 'b', 'c'])
    betting.raiseTo('c', 100)
    betting.call('a')
    betting.raiseTo('b', 300)
    expect(betting.toActId).toBe('c')
    betting.call('c')
    expect(betting.toActId).toBe('a')
    betting.call('a')
    expect(betting.street).toBe('flop')
  })
})

describe('betting all-in and side pots', () => {
  it('runs through remaining streets when nobody can act', () => {
    const betting = hand([10, 20], 0, ['a', 'b'])
    expect(betting.finished).toBe(true)
    expect(betting.street).toBe('river')
    expect(betting.toActId).toBeUndefined()
  })

  it('does not reopen betting after an incomplete all-in raise', () => {
    const betting = hand([1000, 1000, 150], 2, ['a', 'b', 'c'])
    betting.call('c')
    betting.raiseTo('a', 100)
    betting.call('b')
    betting.allIn('c')
    expect(betting.street).toBe('flop')
    expect(betting.toActId).toBe('a')
    expect(betting.sidePots()).toEqual([
      { amount: 300, eligibleIds: ['a', 'b', 'c'] },
      { amount: 50, eligibleIds: ['c'] },
    ])
  })

  it('builds classic side pots across three players', () => {
    const betting = hand([1000, 290, 480], 0, ['a', 'b', 'c'])
    betting.call('a')
    betting.allIn('b')
    betting.allIn('c')
    betting.call('a')
    expect(betting.street).toBe('flop')
    expect(betting.toActId).toBe('a')
    expect(betting.sidePots()).toEqual([
      { amount: 870, eligibleIds: ['a', 'b', 'c'] },
      { amount: 380, eligibleIds: ['a', 'c'] },
    ])
  })

  it('refunds uncalled money when everyone folds', () => {
    const betting = hand([2000, 2000, 2000], 2, ['a', 'b', 'c'])
    betting.raiseTo('c', 200)
    betting.fold('a')
    betting.fold('b')
    expect(betting.finished).toBe(true)
    expect(betting.uncontestedWinnerId).toBe('c')
    expect(betting.sidePots()).toEqual([
      { amount: 30, eligibleIds: ['c'] },
      { amount: 20, eligibleIds: ['c'] },
      { amount: 180, eligibleIds: ['c'] },
    ])
  })

  it('handles a short all-in call', () => {
    const betting = hand([1000, 600], 0, ['a', 'b'])
    betting.check('b')
    betting.raiseTo('a', 1000)
    betting.call('b')
    expect(betting.players[1]?.allIn).toBe(true)
    expect(betting.betToCall('a')).toBe(0)
    expect(betting.street).toBe('river')
    expect(betting.finished).toBe(true)
    expect(betting.sidePots()).toEqual([
      { amount: 1200, eligibleIds: ['a', 'b'] },
      { amount: 400, eligibleIds: ['a'] },
    ])
  })
})

describe('betting validation', () => {
  it('rejects actions out of turn', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    expect(() => betting.check('a')).toThrow(BettingError)
  })

  it('rejects check when facing a bet', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    betting.raiseTo('a', 100)
    expect(() => betting.check('b')).toThrow(BettingError)
  })

  it('rejects a raise below the minimum', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    expect(() => betting.raiseTo('a', 30)).toThrow(BettingError)
  })

  it('rejects raises above the stack', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    betting.check('b')
    expect(() => betting.raiseTo('a', 1500)).toThrow(BettingError)
  })

  it('rejects unknown players and lone games', () => {
    const betting = hand([1000, 1000], 0, ['a', 'b'])
    expect(() => betting.call('ghost')).toThrow(BettingError)
    expect(() => hand([1000], 0, ['a'])).toThrow(BettingError)
  })
})
