import { describe, expect, it } from 'vitest'
import type { ChatterLevel } from './bot-chatter.js'
import {
  cooldownMs,
  nextUtterance,
  quietestFirst,
  shouldSpeak,
  speakChance,
} from './bot-chatter.js'
import type { BotPersonality } from './bot-personality.js'
import type { VoiceEvent, VoiceLine } from './voice-lines.js'
import { lineId } from './voice-lines.js'

const LEVELS: readonly ChatterLevel[] = ['silent', 'occasional', 'constant']
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

function personality(id: string, chatter: ChatterLevel): BotPersonality {
  return {
    id,
    name: id,
    skill: 'rookie',
    aggression: 0.2,
    tightness: 0.5,
    bluffRate: 0.1,
    tiltResistance: 0.2,
    chatter,
  }
}

function voiceLine(personalityId: string, event: VoiceEvent, weight = 1): VoiceLine {
  return {
    id: lineId(personalityId, event, 0),
    personalityId,
    event,
    text: 'said something',
    expression: null,
    weight,
  }
}

describe('speakChance', () => {
  it('is never 0 and never 1 for every chatter level crossed with every event', () => {
    for (const level of LEVELS) {
      for (const event of ALL_EVENTS) {
        const chance = speakChance(personality('x', level), event)
        expect(chance).toBeGreaterThan(0)
        expect(chance).toBeLessThan(1)
      }
    }
  })

  it('gives a constant character a higher chance than a silent one for all events', () => {
    for (const event of ALL_EVENTS) {
      const silent = speakChance(personality('a', 'silent'), event)
      const constant = speakChance(personality('b', 'constant'), event)
      expect(constant).toBeGreaterThan(silent)
    }
  })

  it('gives every chatter level a higher chance for all_in than idle_banter', () => {
    for (const level of LEVELS) {
      const allIn = speakChance(personality('x', level), 'all_in')
      const banter = speakChance(personality('x', level), 'idle_banter')
      expect(allIn).toBeGreaterThan(banter)
    }
  })

  it('gives a high chance for greeting at every level', () => {
    for (const level of LEVELS) {
      expect(speakChance(personality('x', level), 'greeting')).toBeGreaterThan(0.45)
    }
  })

  it('is deterministic for the same input', () => {
    const a = speakChance(personality('x', 'occasional'), 'win_big')
    const b = speakChance(personality('x', 'occasional'), 'win_big')
    expect(b).toBe(a)
  })
})

describe('shouldSpeak', () => {
  it('is true at roll 0 and false at roll 1 for every level', () => {
    for (const level of LEVELS) {
      const p = personality('x', level)
      expect(shouldSpeak(p, 'win_small', 0)).toBe(true)
      expect(shouldSpeak(p, 'win_small', 1)).toBe(false)
    }
  })
})

describe('cooldownMs', () => {
  it('is positive for every level and lowest for constant', () => {
    for (const level of LEVELS) {
      expect(cooldownMs(personality('x', level))).toBeGreaterThan(0)
    }
    expect(cooldownMs(personality('c', 'constant'))).toBeLessThan(
      cooldownMs(personality('s', 'silent')),
    )
  })
})

describe('nextUtterance', () => {
  const chatty = personality('ralph', 'constant')
  const loudLine = voiceLine('ralph', 'all_in')

  it('returns a line when no exclusion applies', () => {
    const line = nextUtterance([loudLine], chatty, 'all_in', null, 0, 0)
    expect(line?.id).toBe(loudLine.id)
  })

  it('returns null while the cooldown has not elapsed', () => {
    const line = nextUtterance([loudLine], chatty, 'all_in', 0, 100, 0)
    expect(line).toBeNull()
  })

  it('returns null when the roll fails the chance', () => {
    const line = nextUtterance([loudLine], chatty, 'idle_banter', null, 0, 1)
    expect(line).toBeNull()
  })

  it('returns null when the character has no line for the event', () => {
    const line = nextUtterance([], chatty, 'lose_small', null, 0, 0)
    expect(line).toBeNull()
  })

  it('treats a null lastSpokeAtMs as never having spoken', () => {
    const quiet = personality('q', 'silent')
    const line = nextUtterance([voiceLine('q', 'greeting')], quiet, 'greeting', null, 0, 0)
    expect(line).not.toBeNull()
  })

  it('is cooldown-bound but speaks once it has cooled down', () => {
    const during = nextUtterance([loudLine], chatty, 'all_in', 0, 10, 0)
    expect(during).toBeNull()
    const after = nextUtterance([loudLine], chatty, 'all_in', 0, cooldownMs(chatty) * 2, 0)
    expect(after).not.toBeNull()
  })
})

describe('quietestFirst', () => {
  it('sorts silent to constant and is stable within a level', () => {
    const a = personality('a', 'constant')
    const b = personality('b', 'silent')
    const c = personality('c', 'constant')
    const d = personality('d', 'occasional')
    const result = quietestFirst([a, b, c, d])
    expect(result.map((value) => value.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('returns an empty array for an empty input', () => {
    expect(quietestFirst([])).toHaveLength(0)
  })
})
