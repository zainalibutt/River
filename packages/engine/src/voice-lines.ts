import type { BotPersonality } from './bot-personality.js'

export type VoiceEvent =
  | 'win_big'
  | 'win_small'
  | 'lose_big'
  | 'lose_small'
  | 'bluff_caught'
  | 'fold_pressured'
  | 'all_in'
  | 'raise'
  | 'bad_beat'
  | 'greeting'
  | 'idle_banter'
  | 'opponent_stalling'

export type VoiceExpression = 'sigh' | 'laugh' | 'scoff' | 'groan' | 'cheer' | 'tut' | 'breath'

export interface VoiceLine {
  id: string
  personalityId: string
  event: VoiceEvent
  text: string
  expression: VoiceExpression | null
  weight: number
}

const ALL_EVENTS: readonly VoiceEvent[] = [
  'win_big',
  'win_small',
  'lose_big',
  'lose_small',
  'bluff_caught',
  'fold_pressured',
  'all_in',
  'raise',
  'bad_beat',
  'greeting',
  'idle_banter',
  'opponent_stalling',
]

const MAX_TEXT_LENGTH = 180

export function lineId(personalityId: string, event: VoiceEvent, index: number): string {
  return `${sanitise(personalityId)}_${event}_${index}`
}

export function validateLine(line: VoiceLine): string[] {
  const problems: string[] = []
  const expectedPrefix = `${sanitise(line.personalityId)}_${line.event}_`
  if (!line.id.startsWith(expectedPrefix) || !/^\d+$/.test(line.id.slice(expectedPrefix.length))) {
    problems.push(`id '${line.id}' does not match the id computed for its own fields`)
  }
  const hasText = line.text.trim().length > 0
  if (!hasText && line.expression === null) {
    problems.push('line has no text and no expression')
  }
  if (line.weight === 0) {
    problems.push('weight must be greater than zero')
  }
  if (line.weight < 0) {
    problems.push('weight must not be negative')
  }
  if (!Number.isFinite(line.weight)) {
    problems.push('weight must be finite')
  }
  if (line.text.length > MAX_TEXT_LENGTH) {
    problems.push(`text is ${line.text.length} characters, over the ${MAX_TEXT_LENGTH} limit`)
  }
  return problems
}

export function validatePack(lines: readonly VoiceLine[]): string[] {
  const problems: string[] = []
  const ids = new Map<string, number>()
  for (const line of lines) {
    ids.set(line.id, (ids.get(line.id) ?? 0) + 1)
  }
  for (const [id, count] of ids) {
    if (count > 1) {
      problems.push(`duplicate line id '${id}'`)
    }
  }

  const personalities = new Set(lines.map((line) => line.personalityId))
  for (const personalityId of personalities) {
    for (const event of ['greeting', 'win_big'] as const) {
      const present = lines.some(
        (line) => line.personalityId === personalityId && line.event === event,
      )
      if (!present) {
        problems.push(`${personalityId} has no line for '${event}'`)
      }
    }
  }
  return problems
}

export function pickLine(
  lines: readonly VoiceLine[],
  personalityId: string,
  event: VoiceEvent,
  roll: number,
): VoiceLine | null {
  const candidates = lines.filter(
    (line) => line.personalityId === personalityId && line.event === event,
  )
  if (candidates.length === 0) return null
  const total = candidates.reduce((sum, line) => sum + Math.max(0, line.weight), 0)
  if (total <= 0) return null
  const scaled = Math.min(1, Math.max(0, roll)) * total
  let cursor = 0
  for (const line of candidates) {
    cursor += Math.max(0, line.weight)
    if (scaled < cursor) return line
  }
  return candidates[candidates.length - 1] ?? null
}

export function coverage(
  lines: readonly VoiceLine[],
  personalities: readonly BotPersonality[],
): { personalityId: string; missing: VoiceEvent[] }[] {
  const result: { personalityId: string; missing: VoiceEvent[] }[] = []
  for (const personality of personalities) {
    const missing = ALL_EVENTS.filter(
      (event) =>
        !lines.some((line) => line.personalityId === personality.id && line.event === event),
    )
    result.push({ personalityId: personality.id, missing })
  }
  return result
}

function sanitise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
}
