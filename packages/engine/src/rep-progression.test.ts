import { describe, expect, it } from 'vitest'
import { levelsGained, levelTable, progressFor } from './rep-progression.js'

const TABLE = levelTable()

function repRequiredAt(index: number): number {
  const entry = TABLE[index]
  if (entry === undefined) throw new Error(`level table index ${index} is out of bounds`)
  return entry.repRequired
}

describe('level table', () => {
  it('contains at least thirty strictly increasing levels', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(30)
    for (let index = 1; index < TABLE.length; index += 1) {
      expect(repRequiredAt(index)).toBeGreaterThan(repRequiredAt(index - 1))
    }
  })

  it('starts at level one with zero cumulative rep', () => {
    expect(TABLE[0]).toEqual({ level: 1, title: 'Newcomer', repRequired: 0 })
  })

  it('makes each level cost strictly more than the one before', () => {
    for (let index = 2; index < TABLE.length; index += 1) {
      const previousCost = repRequiredAt(index - 1) - repRequiredAt(index - 2)
      const currentCost = repRequiredAt(index) - repRequiredAt(index - 1)
      expect(currentCost).toBeGreaterThan(previousCost)
    }
  })

  it('uses plain poker-room titles without emoji', () => {
    for (const level of TABLE) {
      for (const character of level.title) {
        expect(character.codePointAt(0)).toBeLessThanOrEqual(0x7f)
      }
    }
  })
})

describe('progressFor', () => {
  it('returns level one at zero rep, not level zero', () => {
    const progress = progressFor(0)
    expect(progress.level).toBe(1)
    expect(progress.repIntoLevel).toBe(0)
    expect(progress.fractionThroughLevel).toBe(0)
  })

  it('does not go negative or below level one for a negative total', () => {
    const progress = progressFor(-500)
    expect(progress.level).toBe(1)
    expect(progress.totalRep).toBe(0)
    expect(progress.repIntoLevel).toBe(0)
    expect(progress.fractionThroughLevel).toBe(0)
  })

  it('keeps fraction within zero and one across a large sweep', () => {
    for (let total = 0; total < repRequiredAt(TABLE.length - 1) + 10_000; total += 1_337) {
      const progress = progressFor(total)
      expect(progress.fractionThroughLevel).toBeGreaterThanOrEqual(0)
      expect(progress.fractionThroughLevel).toBeLessThanOrEqual(1)
    }
  })

  it('ticks to the next level with zero fraction exactly at a boundary', () => {
    const progress = progressFor(repRequiredAt(1))
    expect(progress.level).toBe(2)
    expect(progress.repIntoLevel).toBe(0)
    expect(progress.fractionThroughLevel).toBe(0)
    expect(progress.repForNextLevel).toBeGreaterThan(0)
  })

  it('reports a full fraction and zero threshold at and beyond the top', () => {
    const atTop = progressFor(repRequiredAt(TABLE.length - 1))
    expect(atTop.level).toBe(TABLE.length)
    expect(atTop.repForNextLevel).toBe(0)
    expect(atTop.fractionThroughLevel).toBe(1)
    const beyond = progressFor(repRequiredAt(TABLE.length - 1) + 1_000_000)
    expect(beyond.level).toBe(TABLE.length)
    expect(beyond.repForNextLevel).toBe(0)
    expect(beyond.fractionThroughLevel).toBe(1)
  })

  it('does not overflow the level for a total larger than the whole table', () => {
    const progress = progressFor(Number.MAX_SAFE_INTEGER)
    expect(progress.level).toBe(TABLE.length)
    expect(progress.fractionThroughLevel).toBe(1)
  })
})

describe('levelsGained', () => {
  it('counts every boundary crossed in a multi-level jump', () => {
    expect(levelsGained(0, repRequiredAt(3))).toBe(3)
  })

  it('returns zero when no boundary is crossed', () => {
    expect(levelsGained(0, repRequiredAt(1) - 1)).toBe(0)
    expect(levelsGained(100, 99)).toBe(0)
  })

  it('counts exactly one level for a single boundary crossing', () => {
    expect(levelsGained(0, repRequiredAt(1))).toBe(1)
  })

  it('handles negative thresholds like zero', () => {
    expect(levelsGained(-1_000, 5_000)).toBe(levelsGained(0, 5_000))
  })
})
