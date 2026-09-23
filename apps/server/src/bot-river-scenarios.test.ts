import { cardKey, HandCategory } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  generateRiverBettingScenarios,
  sampleRiverBetTrainingExamples,
  sampleRiverPublicBetHistory,
} from './bot-river-scenarios.js'

describe('offline river betting scenarios', () => {
  it('replays distinct cards while keeping the known opponent hand out of the observation', () => {
    const options = { seed: 'river-hidden-info', count: 30, style: 'balanced' as const }
    const first = generateRiverBettingScenarios(options)
    expect(generateRiverBettingScenarios(options)).toEqual(first)
    for (const scenario of first) {
      const { observation, oracle } = scenario
      expect(observation).not.toHaveProperty('oracle')
      expect(observation).not.toHaveProperty('opponentHole')
      expect(observation.opponents).toEqual([])
      expect(observation.seats.every((seat) => !('hole' in seat))).toBe(true)
      expect(
        new Set(
          [...observation.actor.hole, ...observation.board, ...oracle.opponentHole].map(cardKey),
        ).size,
      ).toBe(9)
      expect(observation.amountToCall / (observation.pot + observation.amountToCall)).toBe(0.3)
      expect([0, 0.5, 1]).toContain(oracle.callPotShare)
    }
  })

  it('separates a value-only bettor from an overbluffer on held-out deals', () => {
    const value = generateRiverBettingScenarios({
      seed: 'river-value-confirm',
      count: 400,
      style: 'value',
    })
    const overbluff = generateRiverBettingScenarios({
      seed: 'river-overbluff-confirm',
      count: 400,
      style: 'overbluff',
    })
    const average = (rows: typeof value) =>
      rows.reduce((sum, row) => sum + row.oracle.callPotShare, 0) / rows.length
    expect(average(overbluff)).toBeGreaterThan(average(value))
  })

  it('refuses invalid sample sizes', () => {
    expect(() => generateRiverBettingScenarios({ seed: 'x', count: 0, style: 'value' })).toThrow(
      'between 1 and 10000',
    )
  })

  it('changes only prior public history when its length changes', () => {
    const base = { seed: 'river-history-length', count: 5, style: 'balanced' as const }
    const cold = generateRiverBettingScenarios({ ...base, historyOpportunities: 0 })
    const experienced = generateRiverBettingScenarios({ ...base, historyOpportunities: 64 })
    expect(cold.map((row) => row.observation)).toEqual(experienced.map((row) => row.observation))
    expect(cold.every((row) => row.publicHistory.opportunities === 0)).toBe(true)
    expect(experienced.every((row) => row.publicHistory.opportunities === 64)).toBe(true)
  })

  it('samples public-history opportunity categories at seven-card frequencies', () => {
    const examples = sampleRiverBetTrainingExamples('balanced', 'category-frequency', 20_000)
    const highCards = examples.filter((row) => row.category === HandCategory.HIGH_CARD).length
    const pairs = examples.filter((row) => row.category === HandCategory.PAIR).length
    expect(highCards / examples.length).toBeCloseTo(23_294_460 / 133_784_560, 1)
    expect(pairs / examples.length).toBeCloseTo(58_627_800 / 133_784_560, 1)
  })

  it('makes a frequency-matched but more bluff-heavy opponent unidentifiable from bet counts', () => {
    const balanced = sampleRiverBetTrainingExamples('balanced', 'matched-balanced', 20_000)
    const camouflaged = sampleRiverBetTrainingExamples('camouflaged', 'matched-camouflaged', 20_000)
    const betRate = (rows: typeof balanced) => rows.filter((row) => row.bet).length / rows.length
    const bluffShare = (rows: typeof balanced) => {
      const bets = rows.filter((row) => row.bet)
      return bets.filter((row) => row.category === HandCategory.HIGH_CARD).length / bets.length
    }
    expect(Math.abs(betRate(balanced) - betRate(camouflaged))).toBeLessThan(0.03)
    expect(bluffShare(camouflaged) - bluffShare(balanced)).toBeGreaterThan(0.15)
  })

  it('reveals only sampled earlier bets without changing their public frequency', () => {
    const options = { seed: 'public-showdowns', count: 10, style: 'camouflaged' as const }
    const hidden = generateRiverBettingScenarios(options)
    const shown = generateRiverBettingScenarios({ ...options, historyRevealProbability: 0.5 })
    expect(shown.map((row) => row.observation)).toEqual(hidden.map((row) => row.observation))
    for (let index = 0; index < shown.length; index += 1) {
      const publicHistory = shown[index]?.publicHistory
      expect(publicHistory?.opportunities).toBe(hidden[index]?.publicHistory.opportunities)
      expect(publicHistory?.bets).toBe(hidden[index]?.publicHistory.bets)
      expect(publicHistory?.revealedBetCategories?.length).toBeLessThanOrEqual(
        publicHistory?.bets ?? 0,
      )
      expect(publicHistory).not.toHaveProperty('opponentHole')
    }
  })

  it('keeps public counts fixed while biased reveal selection hides more bluffs', () => {
    const uniform = sampleRiverPublicBetHistory('camouflaged', 'biased-reveals', 10_000, 0.25)
    const biased = sampleRiverPublicBetHistory(
      'camouflaged',
      'biased-reveals',
      10_000,
      0.25,
      'made-biased',
    )
    expect(uniform.opportunities).toBe(biased.opportunities)
    expect(uniform.bets).toBe(biased.bets)
    const highCardShare = (categories: readonly HandCategory[]) =>
      categories.filter((category) => category === HandCategory.HIGH_CARD).length /
      categories.length
    expect(highCardShare(biased.revealedBetCategories ?? [])).toBeLessThan(
      highCardShare(uniform.revealedBetCategories ?? []),
    )
  })
})
