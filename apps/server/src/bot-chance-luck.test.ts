import { type Card, cardKey, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { chanceLuck } from './bot-chance-luck.js'

const cards = (text: string) => text.split(' ').map(parseCard)

describe("the cards' luck", () => {
  const focal = cards('Ah Kh')
  const other = cards('Qs Qd')
  const known = (board: readonly Card[]) => new Set([...focal, ...other, ...board].map(cardKey))

  it('averages to nothing over every river that could come', () => {
    const turn = cards('Qh 7h 2c 9d')
    let total = 0
    let count = 0
    for (const river of makeDeck()) {
      if (known(turn).has(cardKey(river))) continue
      total += chanceLuck(focal, other, [{ before: turn, after: [...turn, river], pot: 300 }], 's')
      count += 1
    }
    expect(count).toBe(44)
    expect(total / count).toBeCloseTo(0, 9)
  })

  it('averages to nothing over every turn that could come, and is not nothing on each', () => {
    const flop = cards('Qh 7h 2c')
    let total = 0
    let largest = 0
    let count = 0
    for (const turn of makeDeck()) {
      if (known(flop).has(cardKey(turn))) continue
      const luck = chanceLuck(
        focal,
        other,
        [{ before: flop, after: [...flop, turn], pot: 120 }],
        's',
      )
      total += luck
      largest = Math.max(largest, Math.abs(luck))
      count += 1
    }
    expect(count).toBe(45)
    expect(total / count).toBeCloseTo(0, 9)
    // A heart turns the flush draw on: a real swing, taken out of the result.
    expect(largest).toBeGreaterThan(10)
  })

  it('adds the deals of a hand together, and is nothing when no cards were dealt', () => {
    const flop = cards('Qh 7h 2c')
    const turn = [...flop, ...cards('9d')]
    const both = chanceLuck(
      focal,
      other,
      [
        { before: flop, after: turn, pot: 120 },
        { before: turn, after: [...turn, ...cards('3h')], pot: 300 },
      ],
      's',
    )
    const first = chanceLuck(focal, other, [{ before: flop, after: turn, pot: 120 }], 's')
    const second = chanceLuck(
      focal,
      other,
      [{ before: turn, after: [...turn, ...cards('3h')], pot: 300 }],
      's',
    )
    expect(both).toBeCloseTo(first + second, 9)
    expect(chanceLuck(focal, other, [], 's')).toBe(0)
  })
})
