import { describe, expect, it } from 'vitest'
import {
  BOT_EQUITY_TUNING,
  estimatePreflopEquity,
  estimateShowdownEquity,
  exactHeadsUpRiverEquity,
  handIsInPreflopRange,
} from './bot-equity.js'
import { parseCard } from './cards.js'

const hole = (first: string, second: string) => [parseCard(first), parseCard(second)] as const

describe('offline preflop showdown-equity reference', () => {
  it('enumerates every legal heads-up river hand without sampling or hidden cards', () => {
    const board = ['Qs', 'Js', 'Ts', '2h', '3c'].map(parseCard)
    const royal = exactHeadsUpRiverEquity(hole('As', 'Ks'), board)
    expect(royal.random).toEqual({ combinations: 990, potShare: 1 })
    expect(royal.premium.combinations).toBeGreaterThan(0)
    expect(royal.premium.potShare).toBe(1)
    const publicRoyal = ['Ts', 'Js', 'Qs', 'Ks', 'As'].map(parseCard)
    expect(exactHeadsUpRiverEquity(hole('2c', '3d'), publicRoyal).random.potShare).toBe(0.5)
    expect(() => exactHeadsUpRiverEquity(hole('As', 'As'), board)).toThrow('distinct')
    expect(() => exactHeadsUpRiverEquity(hole('As', 'Ks'), board.slice(0, 4))).toThrow(
      'five board cards',
    )
  })
  it('replays seeded trials and conserves outcomes', () => {
    const options = { hole: hole('As', 'Ah'), opponents: 8, seed: 'nine-seat-equity', trials: 200 }
    const first = estimatePreflopEquity(options)
    expect(estimatePreflopEquity(options)).toEqual(first)
    expect(first.outrightWins + first.tiedWins + first.losses).toBe(200)
    expect(first.potShare).toBeGreaterThan(0)
    expect(first.potShare).toBeLessThan(1)
  })

  it('recognises that aces beat seven-deuce and more opponents reduce their share', () => {
    const aces = hole('As', 'Ah')
    const trash = hole('7s', '2h')
    const headsUp = estimatePreflopEquity({
      hole: aces,
      opponents: 1,
      seed: 'heads-up',
      trials: 500,
    })
    const nineWay = estimatePreflopEquity({
      hole: aces,
      opponents: 8,
      seed: 'nine-way',
      trials: 500,
    })
    const nineWayTrash = estimatePreflopEquity({
      hole: trash,
      opponents: 8,
      seed: 'nine-way-trash',
      trials: 500,
    })
    expect(headsUp.potShare).toBeGreaterThan(nineWay.potShare)
    expect(nineWay.potShare).toBeGreaterThan(nineWayTrash.potShare)
  })

  it('rejects duplicate cards, impossible table sizes and unbounded work', () => {
    const options = { hole: hole('As', 'Ah'), opponents: 8, seed: 'invalid' }
    expect(() => estimatePreflopEquity({ ...options, hole: hole('As', 'As') })).toThrow('distinct')
    expect(() => estimatePreflopEquity({ ...options, opponents: 9 })).toThrow('between 1 and 8')
    expect(() =>
      estimatePreflopEquity({ ...options, trials: BOT_EQUITY_TUNING.maximumTrials + 1 }),
    ).toThrow('trials must be between')
  })

  it('keeps authored ranges distinct and rejects unknown or mismatched profiles', () => {
    expect(handIsInPreflopRange(hole('As', 'Ah'), 'premium')).toBe(true)
    expect(handIsInPreflopRange(hole('As', 'Kh'), 'premium')).toBe(true)
    expect(handIsInPreflopRange(hole('7s', '2h'), 'loose')).toBe(false)
    expect(handIsInPreflopRange(hole('7s', '6s'), 'loose')).toBe(true)
    expect(handIsInPreflopRange(hole('7s', '6s'), 'tight')).toBe(false)
    expect(handIsInPreflopRange(hole('9s', '9h'), 'tight')).toBe(true)
    expect(() =>
      estimatePreflopEquity({
        hole: hole('As', 'Kh'),
        opponents: 2,
        seed: 'bad-count',
        ranges: ['tight'],
      }),
    ).toThrow('one supported hand range per opponent')
    expect(() =>
      estimatePreflopEquity({
        hole: hole('As', 'Kh'),
        opponents: 1,
        seed: 'bad-name',
        ranges: ['unknown' as 'tight'],
      }),
    ).toThrow('one supported hand range per opponent')
  })

  it('replays blocked-card range trials and distinguishes action-strength assumptions', () => {
    const base = { hole: hole('As', 'Ks'), opponents: 2, trials: 500 }
    const random = estimatePreflopEquity({
      ...base,
      seed: 'range-check',
      ranges: ['random', 'random'],
    })
    const tight = estimatePreflopEquity({
      ...base,
      seed: 'range-check',
      ranges: ['tight', 'tight'],
    })
    expect(
      estimatePreflopEquity({ ...base, seed: 'range-check', ranges: ['tight', 'tight'] }),
    ).toEqual(tight)
    expect(tight.outrightWins + tight.tiedWins + tight.losses).toBe(base.trials)
    expect(tight.potShare).toBeLessThan(random.potShare)
  })

  it('supports a full nine-player table with authored ranges', () => {
    const result = estimatePreflopEquity({
      hole: hole('As', 'Ks'),
      opponents: 8,
      ranges: Array(8).fill('loose'),
      seed: 'nine-range-baseline',
      trials: 50,
    })
    expect(result.outrightWins + result.tiedWins + result.losses).toBe(50)
    expect(result.potShare).toBeGreaterThan(0)
    expect(result.potShare).toBeLessThan(1)
  })

  it('finishes flop and turn boards without reusing visible cards', () => {
    const base = {
      hole: hole('As', 'Ks'),
      opponents: 2,
      ranges: ['tight', 'loose'] as const,
      seed: 'known-board',
      trials: 100,
    }
    for (const board of [
      ['Qs', 'Js', '2c'],
      ['Qs', 'Js', '2c', '9h'],
    ]) {
      const options = { ...base, board: board.map(parseCard) }
      const result = estimateShowdownEquity(options)
      expect(estimateShowdownEquity(options)).toEqual(result)
      expect(result.outrightWins + result.tiedWins + result.losses).toBe(100)
      expect(result.potShare).toBeGreaterThan(0)
    }
  })

  it('splits an unbeatable board and recognises a private royal flush', () => {
    const publicRoyal = ['Ts', 'Js', 'Qs', 'Ks', 'As'].map(parseCard)
    const tie = estimateShowdownEquity({
      hole: hole('2c', '3d'),
      board: publicRoyal,
      opponents: 8,
      seed: 'board-plays',
      trials: 20,
    })
    expect(tie.tiedWins).toBe(20)
    expect(tie.potShare).toBeCloseTo(1 / 9, 12)
    const privateRoyal = estimateShowdownEquity({
      hole: hole('As', 'Ks'),
      board: ['Qs', 'Js', 'Ts', '2h', '3c'].map(parseCard),
      opponents: 1,
      seed: 'private-royal',
      trials: 20,
    })
    expect(privateRoyal.outrightWins).toBe(20)
    expect(privateRoyal.potShare).toBe(1)
  })

  it('rejects incomplete streets and reused hole or board cards', () => {
    const base = { hole: hole('As', 'Kh'), opponents: 1, seed: 'invalid-board' }
    expect(() => estimateShowdownEquity({ ...base, board: [parseCard('2c')] })).toThrow(
      '0, 3, 4 or 5',
    )
    expect(() =>
      estimateShowdownEquity({ ...base, board: ['As', '2c', '3d'].map(parseCard) }),
    ).toThrow('distinct')
    expect(() =>
      estimateShowdownEquity({ ...base, board: ['2c', '2c', '3d'].map(parseCard) }),
    ).toThrow('distinct')
  })
})
