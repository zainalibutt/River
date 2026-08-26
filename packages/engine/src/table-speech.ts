import type { ChatterLevel } from './bot-chatter.js'
import { cooldownMs } from './bot-chatter.js'
import type { BotPersonality } from './bot-personality.js'
import type { VoiceEvent } from './voice-lines.js'

export interface SpeechCandidate {
  seat: number
  personalityId: string
  chatter: ChatterLevel
  event: VoiceEvent
  priority: number
}

export interface ScheduledUtterance {
  seat: number
  personalityId: string
  event: VoiceEvent
  delayMs: number
}

export interface TableSpeechOptions {
  maxConcurrent?: number
  spacingMs?: number
}

const DEFAULT_MAX_CONCURRENT = 3
const DEFAULT_SPACING_MS = 400

export function scheduleTableSpeech(
  candidates: readonly SpeechCandidate[],
  lastSpokeAtMs: ReadonlyMap<number, number>,
  nowMs: number,
  options?: TableSpeechOptions,
): ScheduledUtterance[] {
  const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT
  const spacingMs = options?.spacingMs ?? DEFAULT_SPACING_MS
  if (maxConcurrent <= 0) return []

  const bestBySeat = new Map<number, SpeechCandidate>()
  for (const candidate of candidates) {
    const existing = bestBySeat.get(candidate.seat)
    if (existing === undefined || candidate.priority > existing.priority) {
      bestBySeat.set(candidate.seat, candidate)
    }
  }

  const eligible = [...bestBySeat.values()].filter((candidate) => {
    const last = lastSpokeAtMs.get(candidate.seat)
    return last === undefined || nowMs - last >= cooldownForChatter(candidate.chatter)
  })

  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return a.seat - b.seat
  })

  return eligible.slice(0, maxConcurrent).map((candidate, index) => ({
    seat: candidate.seat,
    personalityId: candidate.personalityId,
    event: candidate.event,
    delayMs: index * spacingMs,
  }))
}

function cooldownForChatter(chatter: ChatterLevel): number {
  return cooldownMs({ chatter } as unknown as BotPersonality)
}
