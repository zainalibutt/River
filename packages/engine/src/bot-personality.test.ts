import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { BotPersonality } from './bot-personality.js'
import { blend, personalitiesFor, personalityPool, pickPersonalities } from './bot-personality.js'
import type { BotSkill } from './bots.js'

const POOL = personalityPool()
const SKILLS: readonly BotSkill[] = ['rookie', 'novice', 'og']

function poolEntry(): BotPersonality {
  const first = POOL[0]
  if (first === undefined) throw new Error('personality pool is empty')
  return first
}

describe('personality pool', () => {
  it('contains at least twelve personalities with unique ids', () => {
    expect(POOL.length).toBeGreaterThanOrEqual(12)
    const ids = POOL.map((personality) => personality.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every numeric trait within zero and one', () => {
    for (const personality of POOL) {
      expect(personality.aggression).toBeGreaterThanOrEqual(0)
      expect(personality.aggression).toBeLessThanOrEqual(1)
      expect(personality.tightness).toBeGreaterThanOrEqual(0)
      expect(personality.tightness).toBeLessThanOrEqual(1)
      expect(personality.bluffRate).toBeGreaterThanOrEqual(0)
      expect(personality.bluffRate).toBeLessThanOrEqual(1)
      expect(personality.tiltResistance).toBeGreaterThanOrEqual(0)
      expect(personality.tiltResistance).toBeLessThanOrEqual(1)
    }
  })

  it('gives every skill tier at least three personalities', () => {
    for (const skill of SKILLS) {
      expect(personalitiesFor(skill).length).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses plain names without emoji', () => {
    for (const personality of POOL) {
      for (const character of personality.name) {
        expect(character.codePointAt(0)).toBeLessThanOrEqual(0x7f)
      }
    }
  })

  it('imports nothing from betting, shuffle, fairness or evaluator', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./bot-personality.ts', import.meta.url)),
      'utf8',
    )
    for (const forbidden of ['betting', 'shuffle', 'fairness', 'evaluator']) {
      expect(source).not.toContain(`from './${forbidden}.js'`)
    }
  })
})

describe('personalitiesFor', () => {
  it('filters the pool by skill', () => {
    const rookies = personalitiesFor('rookie')
    expect(rookies.length).toBeGreaterThan(0)
    for (const personality of rookies) {
      expect(personality.skill).toBe('rookie')
    }
  })
})

describe('pickPersonalities', () => {
  it('is deterministic for a given seed', () => {
    for (const seed of [0, 1, 42, 99_999]) {
      expect(pickPersonalities(seed, 4)).toEqual(pickPersonalities(seed, 4))
    }
  })

  it('never repeats a personality within one table', () => {
    const chosen = pickPersonalities(7, 5)
    const ids = chosen.map((personality) => personality.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns fewer than requested without repeating or throwing when oversized', () => {
    const chosen = pickPersonalities(3, POOL.length * 2)
    expect(chosen.length).toBeLessThanOrEqual(POOL.length)
    expect(String(chosen).includes('NaN')).toBe(false)
    const ids = chosen.map((personality) => personality.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns nothing for a non-positive count', () => {
    expect(pickPersonalities(0, 0)).toEqual([])
  })
})

describe('blend', () => {
  it('returns the base unchanged at tiltFactor zero', () => {
    const base = poolEntry()
    expect(blend(base, 0)).toEqual(base)
  })

  it('keeps every trait within zero and one at tiltFactor one', () => {
    for (const base of POOL) {
      const blended = blend(base, 1)
      expect(blended.aggression).toBeGreaterThanOrEqual(0)
      expect(blended.aggression).toBeLessThanOrEqual(1)
      expect(blended.tightness).toBeGreaterThanOrEqual(0)
      expect(blended.tightness).toBeLessThanOrEqual(1)
      expect(blended.bluffRate).toBeGreaterThanOrEqual(0)
      expect(blended.bluffRate).toBeLessThanOrEqual(1)
      expect(blended.tiltResistance).toBeGreaterThanOrEqual(0)
      expect(blended.tiltResistance).toBeLessThanOrEqual(1)
    }
  })

  it('moves a low tilt-resistance bot further than a high one', () => {
    const tiltAverse: BotPersonality = {
      ...poolEntry(),
      id: 'tiltaverse',
      name: 'Rock',
      tiltResistance: 0.9,
    }
    const tiltProne: BotPersonality = {
      ...poolEntry(),
      id: 'tiltprone',
      name: 'Short Fuse',
      tiltResistance: 0.1,
    }
    const high = blend(tiltAverse, 0.5)
    const low = blend(tiltProne, 0.5)
    const highShift = Math.abs(high.aggression - tiltAverse.aggression)
    const lowShift = Math.abs(low.aggression - tiltProne.aggression)
    expect(lowShift).toBeGreaterThan(highShift)
  })

  it('clamps a negative tilt factor to zero', () => {
    const base = poolEntry()
    expect(blend(base, -0.5)).toEqual(base)
  })
})
