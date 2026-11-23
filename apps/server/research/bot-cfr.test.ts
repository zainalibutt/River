import { describe, expect, it } from 'vitest'
import { expectedValue, exploitability, type Strategy, trainCfr } from './bot-cfr.js'
import { KUHN_GAME_VALUE, kuhnPoker } from './bot-cfr-kuhn.js'

describe('counterfactual regret minimisation on Kuhn poker', () => {
  it('sees how exploitable a strategy that is not an equilibrium is', () => {
    const uniform: Strategy = new Map()
    expect(exploitability(kuhnPoker, uniform)).toBeGreaterThan(0.1)
    const alwaysBet: Strategy = new Map(
      ['0:', '1:', '2:', '0:p', '1:p', '2:p', '0:b', '1:b', '2:b', '0:pb', '1:pb', '2:pb'].map(
        (key) => [key, [0, 1]],
      ),
    )
    expect(exploitability(kuhnPoker, alwaysBet)).toBeGreaterThan(0.1)
  })

  it('converges to the known equilibrium value, less exploitable the longer it trains', () => {
    const early = exploitability(kuhnPoker, trainCfr(kuhnPoker, 500))
    const strategy = trainCfr(kuhnPoker, 5_000)
    const late = exploitability(kuhnPoker, strategy)
    expect(expectedValue(kuhnPoker, strategy)).toBeCloseTo(KUHN_GAME_VALUE, 2)
    expect(late).toBeLessThan(0.005)
    expect(late).toBeLessThan(early / 2)
  })

  it('learns the known shape of the equilibrium', () => {
    const strategy = trainCfr(kuhnPoker, 5_000)
    const bet = (key: string) => strategy.get(key)?.[1] ?? Number.NaN
    // Facing a bet, the second player folds the jack and calls with the king.
    expect(bet('0:b')).toBeLessThan(0.01)
    expect(bet('2:b')).toBeGreaterThan(0.99)
    // It calls with the queen a third of the time, making the first player's jack bluffs break even.
    expect(bet('1:b')).toBeCloseTo(1 / 3, 1)
    // The first player bets the king three times as often as it bluffs the jack.
    expect(bet('2:')).toBeCloseTo(3 * bet('0:'), 1)
  })
})
