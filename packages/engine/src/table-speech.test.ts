import { describe, expect, it } from 'vitest'
import type { SpeechCandidate } from './table-speech.js'
import { scheduleTableSpeech } from './table-speech.js'
import type { VoiceEvent } from './voice-lines.js'

const EVENT: VoiceEvent = 'bad_beat'

function candidate(
  seat: number,
  priority: number,
  chatter: SpeechCandidate['chatter'] = 'constant',
): SpeechCandidate {
  return { seat, personalityId: `p${seat}`, chatter, event: EVENT, priority }
}

function nineConstantTalkers(
  priorities: number[] = [1, 1, 1, 1, 1, 1, 1, 1, 1],
): SpeechCandidate[] {
  return priorities.map((priority, seat) => candidate(seat, priority))
}

describe('scheduleTableSpeech', () => {
  it('caps nine constant talkers to three at 0, 400 and 800ms', () => {
    const result = scheduleTableSpeech(nineConstantTalkers(), new Map(), 0)
    expect(result).toHaveLength(3)
    expect(result.map((item) => item.delayMs)).toEqual([0, 400, 800])
    expect(result.map((item) => item.seat)).toEqual([0, 1, 2])
  })

  it('drops the low-priority candidates, not the first ones in the array', () => {
    const priorities = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const result = scheduleTableSpeech(nineConstantTalkers(priorities), new Map(), 0)
    expect(result).toHaveLength(3)
    expect(result.map((item) => item.seat)).toEqual([8, 7, 6])
    expect(result.map((item) => item.delayMs)).toEqual([0, 400, 800])
  })

  it('returns an empty array for no candidates', () => {
    expect(scheduleTableSpeech([], new Map(), 0)).toEqual([])
  })

  it('speaks a single candidate at delay 0, not at spacingMs', () => {
    const result = scheduleTableSpeech([candidate(4, 1)], new Map(), 0)
    expect(result).toHaveLength(1)
    expect(result[0]?.seat).toBe(4)
    expect(result[0]?.delayMs).toBe(0)
  })

  it('drops a seat that is still inside its own cooldown', () => {
    const constant = candidate(0, 1, 'constant')
    const under = scheduleTableSpeech([constant], new Map([[0, 0]]), 1000)
    expect(under).toHaveLength(0)
    const past = scheduleTableSpeech([constant], new Map([[0, 0]]), 1600)
    expect(past).toHaveLength(1)
  })

  it('respects the silent cooldown independently', () => {
    const silent = candidate(0, 1, 'silent')
    const mid = scheduleTableSpeech([silent], new Map([[0, 0]]), 3000)
    expect(mid).toHaveLength(0)
    const past = scheduleTableSpeech([silent], new Map([[0, 0]]), 4100)
    expect(past).toHaveLength(1)
  })

  it('keeps only the highest-priority entry for a seat appearing twice', () => {
    const candidates = [candidate(3, 2, 'occasional'), candidate(3, 8, 'constant')]
    const result = scheduleTableSpeech(candidates, new Map(), 0)
    expect(result).toHaveLength(1)
    expect(result[0]?.seat).toBe(3)
    expect(result[0]?.personalityId).toBe('p3')
  })

  it('orders by priority descending, then by seat, and assigns spacing in that order', () => {
    const scrambled = [
      candidate(5, 1),
      candidate(2, 9),
      candidate(8, 4),
      candidate(1, 7),
      candidate(3, 6),
    ]
    const result = scheduleTableSpeech(scrambled, new Map(), 0)
    expect(result).toHaveLength(3)
    const expectedOrder = [2, 1, 3]
    expect(result.map((item) => item.seat)).toEqual(expectedOrder)
    expect(result.map((item) => item.delayMs)).toEqual([0, 400, 800])
  })

  it('honours a custom maxConcurrent', () => {
    const result = scheduleTableSpeech(nineConstantTalkers(), new Map(), 0, {
      maxConcurrent: 1,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.delayMs).toBe(0)
  })

  it('returns an empty array for a non-positive maxConcurrent', () => {
    expect(scheduleTableSpeech(nineConstantTalkers(), new Map(), 0, { maxConcurrent: 0 })).toEqual(
      [],
    )
  })

  it('honours a custom spacingMs', () => {
    const result = scheduleTableSpeech(nineConstantTalkers(), new Map(), 0, {
      spacingMs: 1000,
    })
    expect(result.map((item) => item.delayMs)).toEqual([0, 1000, 2000])
  })

  it('is deterministic for identical input', () => {
    const input = nineConstantTalkers([5, 2, 8, 1, 6, 3, 7, 4, 9])
    const first = scheduleTableSpeech(input, new Map([[1, 100]]), 1000)
    const second = scheduleTableSpeech(input, new Map([[1, 100]]), 1000)
    expect(second).toEqual(first)
  })
})
