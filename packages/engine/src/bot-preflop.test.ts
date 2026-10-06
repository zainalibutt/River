import { describe, expect, it } from 'vitest'
import { preflopHandStrengthV2 } from './bot-preflop.js'
import { parseCard } from './cards.js'

const score = (first: string, second: string) =>
  preflopHandStrengthV2([parseCard(first), parseCard(second)])

describe('OG candidate starting-hand score', () => {
  it('orders premiums, speculative pairs and trash without treating all pairs as monsters', () => {
    expect(score('As', 'Ah')).toBeGreaterThan(score('As', 'Ks'))
    expect(score('As', 'Ks')).toBeGreaterThan(score('2s', '2h'))
    expect(score('Ks', 'Qs')).toBeGreaterThan(score('2s', '2h'))
    expect(score('2s', '2h')).toBeGreaterThan(score('7s', '2h'))
    expect(score('As', 'Ks')).toBeGreaterThan(score('As', 'Kh'))
    expect(score('Js', '9s')).toBeGreaterThan(score('Js', '9h'))
  })

  it('returns a bounded score and refuses missing cards', () => {
    for (const first of ['2s', '7h', 'Jd', 'As']) {
      for (const second of ['2h', '9s', 'Qc', 'Ad']) {
        expect(score(first, second)).toBeGreaterThanOrEqual(0)
        expect(score(first, second)).toBeLessThanOrEqual(1)
      }
    }
    expect(() => preflopHandStrengthV2([parseCard('As')])).toThrow('exactly two')
  })
})
