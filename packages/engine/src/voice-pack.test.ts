import { describe, expect, it } from 'vitest'
import { personalityPool } from './bot-personality.js'
import type { VoiceEvent } from './voice-lines.js'
import { coverage, lineId, pickLine, validateLine, validatePack } from './voice-lines.js'
import { VOICE_PACK } from './voice-pack.js'

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

describe('voice pack', () => {
  it('is a full pack with no cross-pack problems', () => {
    expect(validatePack(VOICE_PACK)).toEqual([])
  })

  it('has every individual line valid', () => {
    for (const line of VOICE_PACK) {
      expect(validateLine(line)).toEqual([])
    }
  })

  it('gives every personality coverage for every event', () => {
    const report = coverage(VOICE_PACK, personalityPool())
    expect(report).toHaveLength(personalityPool().length)
    for (const entry of report) {
      expect(entry.missing).toEqual([])
    }
  })

  it('returns a line for all 156 groups at rolls 0, 0.5 and 0.999', () => {
    const personalities = personalityPool()
    for (const personality of personalities) {
      for (const event of ALL_EVENTS) {
        for (const roll of [0, 0.5, 0.999]) {
          expect(pickLine(VOICE_PACK, personality.id, event, roll)).not.toBeNull()
        }
      }
    }
  })

  it('feeds every line id from lineId, so ids match their own fields', () => {
    for (const line of VOICE_PACK) {
      expect(line.id).toBe(lineId(line.personalityId, line.event, indexInGroup(VOICE_PACK, line)))
    }
  })

  it('discriminates by weight within a known group', () => {
    const first = pickLine(VOICE_PACK, 'lilah', 'win_big', 0)
    const last = pickLine(VOICE_PACK, 'lilah', 'win_big', 0.999)
    expect(first).not.toBeNull()
    expect(last).not.toBeNull()
    expect(first?.id).not.toBe(last?.id)
  })

  it('never repeats a text within one personality, ignoring empty expressions', () => {
    const personalities = personalityPool()
    for (const personality of personalities) {
      const seen = new Set<string>()
      for (const line of VOICE_PACK) {
        if (line.personalityId !== personality.id) continue
        if (line.text.trim().length === 0) continue
        expect(seen.has(line.text)).toBe(false)
        seen.add(line.text)
      }
    }
  })

  it('keeps each id unique across the whole pack', () => {
    const ids = VOICE_PACK.map((line) => line.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

function indexInGroup(
  pack: readonly { id: string; personalityId: string; event: VoiceEvent }[],
  target: { id: string; personalityId: string; event: VoiceEvent },
): number {
  let index = 0
  for (const line of pack) {
    if (line.personalityId === target.personalityId && line.event === target.event) {
      if (line.id === target.id) return index
      index += 1
    }
  }
  return -1
}
