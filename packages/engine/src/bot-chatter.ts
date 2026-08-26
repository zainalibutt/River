import type { BotPersonality } from './bot-personality.js'
import type { VoiceEvent, VoiceLine } from './voice-lines.js'
import { pickLine } from './voice-lines.js'

export type ChatterLevel = BotPersonality['chatter']

const LOUD_EVENTS: ReadonlySet<VoiceEvent> = new Set<VoiceEvent>([
  'win_big',
  'lose_big',
  'all_in',
  'bad_beat',
  'raise',
])

interface ChanceTable {
  quiet: number
  loud: number
  greeting: number
}

const CHANCE_BY_CHATTER: Record<ChatterLevel, ChanceTable> = {
  silent: { quiet: 0.05, loud: 0.2, greeting: 0.5 },
  occasional: { quiet: 0.25, loud: 0.75, greeting: 0.8 },
  constant: { quiet: 0.55, loud: 0.82, greeting: 0.92 },
}

const COOLDOWN_BY_CHATTER: Record<ChatterLevel, number> = {
  silent: 4000,
  occasional: 2600,
  constant: 1500,
}

const CHATTER_ORDER: readonly ChatterLevel[] = ['silent', 'occasional', 'constant']

export function speakChance(personality: BotPersonality, event: VoiceEvent): number {
  const table = CHANCE_BY_CHATTER[personality.chatter]
  if (event === 'greeting') return table.greeting
  return LOUD_EVENTS.has(event) ? table.loud : table.quiet
}

export function shouldSpeak(personality: BotPersonality, event: VoiceEvent, roll: number): boolean {
  return roll < speakChance(personality, event)
}

export function cooldownMs(personality: BotPersonality): number {
  return COOLDOWN_BY_CHATTER[personality.chatter]
}

export function nextUtterance(
  lines: readonly VoiceLine[],
  personality: BotPersonality,
  event: VoiceEvent,
  lastSpokeAtMs: number | null,
  nowMs: number,
  roll: number,
): VoiceLine | null {
  if (lastSpokeAtMs !== null && nowMs - lastSpokeAtMs < cooldownMs(personality)) {
    return null
  }
  if (!shouldSpeak(personality, event, roll)) {
    return null
  }
  return pickLine(lines, personality.id, event, roll)
}

export function quietestFirst(personalities: readonly BotPersonality[]): readonly BotPersonality[] {
  const indexed = personalities.map((personality, index) => ({ personality, index }))
  indexed.sort((a, b) => {
    const aLevel = CHATTER_ORDER.indexOf(a.personality.chatter)
    const bLevel = CHATTER_ORDER.indexOf(b.personality.chatter)
    return aLevel !== bLevel ? aLevel - bLevel : a.index - b.index
  })
  return indexed.map((entry) => entry.personality)
}
