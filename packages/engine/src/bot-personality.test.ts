import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bluffMultiplier } from './bot-equity-core.js'
import type { BotPersonality } from './bot-personality.js'
import {
  BOT_TABLE_PRESETS,
  blend,
  championPersonality,
  isBotTablePreset,
  personalitiesFor,
  personalityPool,
  pickPersonalities,
  pickPersonalitiesForPreset,
} from './bot-personality.js'
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

describe('table presets', () => {
  it('recognises only the public preset names', () => {
    for (const preset of ['casual', 'mixed', 'tough', 'random', 'champion']) {
      expect(isBotTablePreset(preset)).toBe(true)
    }
    expect(isBotTablePreset('expert')).toBe(false)
    expect(isBotTablePreset(3)).toBe(false)
  })

  it('casts the champion alone at a champion table, however many seats it asks for', () => {
    const champion = championPersonality()
    for (const seed of [1, 17, 91, 4242]) {
      for (let count = 1; count <= 8; count += 1) {
        expect(pickPersonalitiesForPreset(seed, count, 'champion')).toEqual([champion])
      }
    }
    expect(pickPersonalitiesForPreset(17, 0, 'champion')).toEqual([])
  })

  it('builds seven unique characters with the promised skill bounds beside the champion', () => {
    const champion = championPersonality()
    const casual = pickPersonalitiesForPreset(17, 7, 'casual')
    const mixed = pickPersonalitiesForPreset(17, 7, 'mixed')
    const tough = pickPersonalitiesForPreset(17, 7, 'tough')
    const others = (cast: readonly BotPersonality[]) => cast.filter((bot) => bot.id !== champion.id)
    expect(casual).toHaveLength(7)
    expect(mixed).toHaveLength(7)
    expect(tough).toHaveLength(7)
    expect(others(casual).every((bot) => bot.skill !== 'og')).toBe(true)
    expect(others(tough).every((bot) => bot.skill !== 'rookie')).toBe(true)
    expect(new Set(others(mixed).map((bot) => bot.skill))).toEqual(
      new Set(['rookie', 'novice', 'og']),
    )
    for (const cast of [casual, mixed, tough]) {
      expect(new Set(cast.map((bot) => bot.id)).size).toBe(cast.length)
    }
  })

  it('keeps a preset cast deterministic for a room seed', () => {
    expect(pickPersonalitiesForPreset(91, 7, 'tough')).toEqual(
      pickPersonalitiesForPreset(91, 7, 'tough'),
    )
  })
})

describe('the champion', () => {
  const champion = championPersonality()

  it('sits exactly once at every table with bots, whatever the preset and size', () => {
    for (const preset of BOT_TABLE_PRESETS) {
      for (let count = 1; count <= 8; count += 1) {
        for (const seed of [1, 17, 91, 4242]) {
          const cast = pickPersonalitiesForPreset(seed, count, preset)
          expect(cast.filter((bot) => bot.id === champion.id)).toHaveLength(1)
          expect(new Set(cast.map((bot) => bot.id)).size).toBe(cast.length)
        }
      }
    }
    expect(pickPersonalitiesForPreset(17, 0, 'casual')).toEqual([])
  })

  it('lands in different places in the cast from room to room', () => {
    const places = new Set(
      Array.from({ length: 40 }, (_, seed) =>
        pickPersonalitiesForPreset(seed, 7, 'random').findIndex((bot) => bot.id === champion.id),
      ),
    )
    expect(places.size).toBeGreaterThan(1)
  })

  it('keeps the rest of the cast in order as a table grows', () => {
    const others = (count: number) =>
      pickPersonalitiesForPreset(23, count, 'mixed').filter((bot) => bot.id !== champion.id)
    expect(others(7).slice(0, others(4).length)).toEqual(others(4))
  })

  it('is an OG kept out of the pool the evaluation harness draws from', () => {
    expect(champion.skill).toBe('og')
    expect(POOL.some((bot) => bot.id === champion.id || bot.name === champion.name)).toBe(false)
  })

  it('bluffs at exactly the balanced rate and never tilts', () => {
    expect(bluffMultiplier(champion)).toBe(1)
    expect(blend(champion, 1)).toEqual(champion)
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
