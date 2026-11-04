import { type Card, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { combosWithFloor } from './bot-river-policy.js'
import {
  bestResponseValue,
  type RangeCombo,
  type RiverSpot,
  riverValues,
  solveRiver,
} from './bot-river-solver.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})

describe('full support in a safe re-solve', () => {
  it('keeps every holding, raising the pruned ones to a floor and leaving the rest', () => {
    const range = [
      { hole: cards('Ac Ad') as [Card, Card], weight: 4 },
      { hole: cards('7c 7d') as [Card, Card], weight: 0 },
      { hole: cards('5h 6h') as [Card, Card], weight: 1 },
    ]
    const kept = combosWithFloor(range, 1e-3)
    expect(kept).toHaveLength(3)
    expect(kept[0]?.weight).toBe(4)
    expect(kept[1]?.weight).toBeCloseTo(4e-3, 12)
    expect(kept[2]?.weight).toBe(1)
  })

  it("never gives a hand the guess ruled out more than the guess's own solve gave it", () => {
    // The guess pruned the set; the floor keeps it in, so it carries a promise, and the
    // re-solve may not let it win more than the solve it came from let it win.
    const board = cards('Ah Kd 7s 4c 2h')
    const ours = [combo('As Qs'), combo('Ks Js'), combo('8s 8h'), combo('Tc 9c')]
    const guess: RangeCombo[] = [
      combo('7c 7d', 1e-4),
      combo('Qc Jc'),
      combo('5d 6d'),
      combo('Kc Qh'),
      combo('9s 9h'),
    ]
    const spot: RiverSpot = {
      board,
      pot: 100,
      stack: 300,
      ranges: [ours, guess],
      betSizes: [0.5, 1],
      allIn: true,
      maxRaises: 1,
    }
    const fromGuess = solveRiver(spot, 1_000)
    const promises = riverValues(fromGuess).values[1]
    const flat: RiverSpot = {
      ...spot,
      ranges: [ours, guess.map((entry) => ({ ...entry, weight: 1 }))],
    }
    const resolved = solveRiver(flat, 1_000, undefined, undefined, { player: 1, promises })
    // The best the set can do against each strategy, alone in player 1's range.
    const onlySet: RiverSpot = { ...spot, ranges: [ours, [combo('7c 7d')]] }
    const against = (solved: ReturnType<typeof solveRiver>) =>
      bestResponseValue({ tree: solved.tree, strategy: solved.strategy, spot: onlySet }, 1) /
      spot.pot
    expect(against(resolved)).toBeLessThan(against(fromGuess) + 0.02)
  }, 120_000)
})
