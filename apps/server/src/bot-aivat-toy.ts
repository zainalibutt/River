import { type AivatControl, aivatChips } from './bot-aivat.js'

/** Three-card, two-player poker: ante 1 each; hero may check to showdown or
 * bet 1; the unknown opponent may fold or call. Enumerate all ordered deals,
 * BOTH hero actions and BOTH opponent replies with their true probabilities.
 * Deliberately imperfect, frozen heuristic; no target-game fitting. */
export function enumerableAivatToy(
  value: (hero: number, action: 'check' | 'bet') => number = (hero, action) =>
    action === 'check' ? (hero - 1) * 0.7 : (hero - 1) * 1.2 + 0.2,
) {
  const deals: { hero: number; other: number }[] = []
  for (let hero = 0; hero < 3; hero++) {
    for (let other = 0; other < 3; other++) if (hero !== other) deals.push({ hero, other })
  }
  const dealValues = deals.map(({ hero, other }, index) => ({
    action: String(index),
    probability: 1 / 6,
    value: (hero - other) * 0.4,
  }))
  const outcomes: { probability: number; raw: number; aivat: number }[] = []
  deals.forEach(({ hero, other }, index) => {
    const win = hero > other ? 1 : -1
    const bet = [0.2, 0.5, 0.8][hero] as number
    const call = [0.1, 0.6, 1][other] as number
    const chance: AivatControl = { kind: 'chance', taken: String(index), choices: dealValues }
    const own = (taken: string): AivatControl => ({
      kind: 'action',
      taken,
      choices: [
        { action: 'check', probability: 1 - bet, value: value(hero, 'check') },
        { action: 'bet', probability: bet, value: value(hero, 'bet') },
      ],
    })
    for (const [probability, raw, action] of [
      [(1 - bet) / 6, win, 'check'],
      [(bet * (1 - call)) / 6, 1, 'bet'],
      [(bet * call) / 6, 2 * win, 'bet'],
    ] as const) {
      outcomes.push({ probability, raw, aivat: aivatChips(raw, [chance, own(action)]) })
    }
  })
  const mean = (key: 'raw' | 'aivat') =>
    outcomes.reduce((sum, row) => sum + row.probability * row[key], 0)
  const variance = (key: 'raw' | 'aivat') =>
    outcomes.reduce((sum, row) => sum + row.probability * (row[key] - mean(key)) ** 2, 0)
  return {
    deals: deals.length,
    paths: outcomes.length,
    probability: outcomes.reduce((sum, row) => sum + row.probability, 0),
    exactExpectation: mean('raw'),
    aivatExpectation: mean('aivat'),
    bias: mean('aivat') - mean('raw'),
    rawVariance: variance('raw'),
    aivatVariance: variance('aivat'),
  }
}
