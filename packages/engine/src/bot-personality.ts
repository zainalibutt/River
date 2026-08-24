import type { BotSkill } from './bots.js'

export interface BotPersonality {
  id: string
  name: string
  skill: BotSkill
  aggression: number
  tightness: number
  bluffRate: number
  tiltResistance: number
  chatter: 'silent' | 'occasional' | 'constant'
}

const POOL: readonly BotPersonality[] = [
  {
    id: 'albie',
    name: 'Albie',
    skill: 'rookie',
    aggression: 0.2,
    tightness: 0.5,
    bluffRate: 0.1,
    tiltResistance: 0.2,
    chatter: 'silent',
  },
  {
    id: 'bernadette',
    name: 'Bernadette',
    skill: 'rookie',
    aggression: 0.35,
    tightness: 0.4,
    bluffRate: 0.2,
    tiltResistance: 0.3,
    chatter: 'constant',
  },
  {
    id: 'clem',
    name: 'Clem',
    skill: 'rookie',
    aggression: 0.15,
    tightness: 0.6,
    bluffRate: 0.05,
    tiltResistance: 0.25,
    chatter: 'occasional',
  },
  {
    id: 'doyle',
    name: 'Doyle',
    skill: 'rookie',
    aggression: 0.25,
    tightness: 0.45,
    bluffRate: 0.15,
    tiltResistance: 0.4,
    chatter: 'silent',
  },
  {
    id: 'edna',
    name: 'Edna',
    skill: 'novice',
    aggression: 0.5,
    tightness: 0.3,
    bluffRate: 0.3,
    tiltResistance: 0.5,
    chatter: 'occasional',
  },
  {
    id: 'frank',
    name: 'Frank',
    skill: 'novice',
    aggression: 0.4,
    tightness: 0.5,
    bluffRate: 0.25,
    tiltResistance: 0.45,
    chatter: 'constant',
  },
  {
    id: 'gordo',
    name: 'Gordo',
    skill: 'novice',
    aggression: 0.6,
    tightness: 0.25,
    bluffRate: 0.35,
    tiltResistance: 0.35,
    chatter: 'silent',
  },
  {
    id: 'hyacinth',
    name: 'Hyacinth',
    skill: 'novice',
    aggression: 0.45,
    tightness: 0.4,
    bluffRate: 0.3,
    tiltResistance: 0.55,
    chatter: 'constant',
  },
  {
    id: 'irving',
    name: 'Irving',
    skill: 'novice',
    aggression: 0.35,
    tightness: 0.55,
    bluffRate: 0.2,
    tiltResistance: 0.6,
    chatter: 'occasional',
  },
  {
    id: 'jules',
    name: 'Jules',
    skill: 'og',
    aggression: 0.65,
    tightness: 0.2,
    bluffRate: 0.4,
    tiltResistance: 0.7,
    chatter: 'silent',
  },
  {
    id: 'kazimir',
    name: 'Kazimir',
    skill: 'og',
    aggression: 0.55,
    tightness: 0.35,
    bluffRate: 0.3,
    tiltResistance: 0.75,
    chatter: 'occasional',
  },
  {
    id: 'lilah',
    name: 'Lilah',
    skill: 'og',
    aggression: 0.7,
    tightness: 0.15,
    bluffRate: 0.45,
    tiltResistance: 0.65,
    chatter: 'constant',
  },
  {
    id: 'mickey',
    name: 'Mickey',
    skill: 'og',
    aggression: 0.6,
    tightness: 0.3,
    bluffRate: 0.35,
    tiltResistance: 0.8,
    chatter: 'constant',
  },
]

export function personalityPool(): readonly BotPersonality[] {
  return POOL
}

export function personalitiesFor(skill: BotSkill): readonly BotPersonality[] {
  return POOL.filter((personality) => personality.skill === skill)
}

export function pickPersonalities(seed: number, count: number): readonly BotPersonality[] {
  if (count <= 0) return []
  const used = new Set<number>()
  const selected: BotPersonality[] = []
  let position = 0
  while (selected.length < count && used.size < POOL.length) {
    const index = hashMix(seed, position) % POOL.length
    position += 1
    if (used.has(index)) continue
    used.add(index)
    const personality = POOL[index]
    if (personality !== undefined) selected.push(personality)
  }
  return selected
}

function hashMix(seed: number, index: number): number {
  let value = (((seed + index * 0x9e3779b9) ^ (seed >>> 16)) >>> 0) + 0x85ebca6b
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value = value ^ (value >>> 16)
  return value >>> 0
}

export function blend(base: BotPersonality, tiltFactor: number): BotPersonality {
  const safeTilt = clamp01(tiltFactor)
  const delta = safeTilt * (1 - base.tiltResistance)
  return {
    ...base,
    aggression: clamp01(base.aggression + delta * 0.5),
    tightness: clamp01(base.tightness - delta * 0.5),
    bluffRate: clamp01(base.bluffRate + delta * 0.5),
    tiltResistance: clamp01(base.tiltResistance * (1 - delta)),
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
