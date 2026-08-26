import { describe, expect, it } from 'vitest'
import type { BotPersonality } from './bot-personality.js'
import type { VoiceEvent, VoiceLine } from './voice-lines.js'
import { coverage, lineId, pickLine, validateLine, validatePack } from './voice-lines.js'

function line(overrides: Partial<VoiceLine>): VoiceLine {
  const base: VoiceLine = {
    id: lineId('albie', 'greeting', 0),
    personalityId: 'albie',
    event: 'greeting',
    text: 'Well, hello there.',
    expression: null,
    weight: 1,
    ...overrides,
  }
  return { ...base, id: overrides.id ?? lineId(base.personalityId, base.event, 0) }
}

const PERSONALITIES: readonly BotPersonality[] = [
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
]

describe('lineId', () => {
  it('is stable, lowercase, and filesystem-safe', () => {
    expect(lineId('Albie', 'win_big', 0)).toBe('albie_win_big_0')
    expect(lineId('albie', 'win_big', 0)).toBe('albie_win_big_0')
    const id = lineId('Hyac3in-th', 'opponent_stalling', 12)
    expect(id).toBe(id.toLowerCase())
    expect(id).toMatch(/^[a-z0-9_-]+$/)
    expect(id).not.toMatch(/[:/\\*?"<>|]/)
  })

  it('produces distinct ids for distinct indices and events', () => {
    expect(lineId('albie', 'raise', 0)).not.toBe(lineId('albie', 'raise', 1))
    expect(lineId('albie', 'raise', 0)).not.toBe(lineId('albie', 'fold_pressured', 0))
  })
})

describe('validateLine', () => {
  it('is clean for a valid spoken line', () => {
    expect(validateLine(line({}))).toHaveLength(0)
  })

  it('flags empty-or-whitespace text with no expression', () => {
    const problems = validateLine(line({ text: '   ', expression: null }))
    expect(problems).toContain('line has no text and no expression')
  })

  it('accepts a line with no text when it has an expression', () => {
    expect(validateLine(line({ text: '', expression: 'sigh' }))).toHaveLength(0)
  })

  it('flags a zero weight', () => {
    expect(validateLine(line({ weight: 0 }))).toContain('weight must be greater than zero')
  })

  it('flags a negative weight', () => {
    expect(validateLine(line({ weight: -2 }))).toContain('weight must not be negative')
  })

  it('flags a non-finite weight', () => {
    expect(validateLine(line({ weight: Number.POSITIVE_INFINITY }))).toContain(
      'weight must be finite',
    )
  })

  it('flags an id that does not match its own fields', () => {
    const problems = validateLine(line({ id: 'someone_else_greeting_0', personalityId: 'albie' }))
    expect(problems.some((problem) => problem.includes('does not match'))).toBe(true)
  })

  it('flags text over 180 characters', () => {
    expect(validateLine(line({ text: 'x'.repeat(181) })).join(' ')).toContain('180 limit')
  })

  it('reports multiple problems in one call', () => {
    const problems = validateLine(line({ text: ' ', expression: null, weight: 0, id: 'broken' }))
    expect(problems.length).toBeGreaterThanOrEqual(3)
  })
})

describe('validatePack', () => {
  it('flags a duplicate id', () => {
    const pack = [line({ id: 'albie_greeting_0' }), line({ id: 'albie_greeting_0' })]
    expect(validatePack(pack)).toContain("duplicate line id 'albie_greeting_0'")
  })

  it('flags a personality missing win_big and greeting', () => {
    const pack = [line({ personalityId: 'albie' })]
    const problems = validatePack(pack)
    expect(problems).toContain("albie has no line for 'win_big'")
    expect(problems).not.toContain("albie has no line for 'greeting'")
  })

  it('is clean for a complete cast', () => {
    const pack = [
      line({ personalityId: 'albie' }),
      line({ personalityId: 'albie', event: 'win_big' }),
      line({ personalityId: 'bernadette' }),
      line({ personalityId: 'bernadette', event: 'win_big' }),
    ]
    expect(validatePack(pack)).toHaveLength(0)
  })
})

describe('pickLine', () => {
  const wins = [
    line({ id: 'albie_win_big_0', event: 'win_big', text: 'Ha.', weight: 1 }),
    line({ id: 'albie_win_big_1', event: 'win_big', text: 'That works.', weight: 3 }),
  ]

  it('respects weights 1 and 3 at rolls 0.1 and 0.9', () => {
    expect(pickLine(wins, 'albie', 'win_big', 0.1)?.id).toBe('albie_win_big_0')
    expect(pickLine(wins, 'albie', 'win_big', 0.9)?.id).toBe('albie_win_big_1')
  })

  it('returns a line at roll 0 and at roll 1', () => {
    expect(pickLine(wins, 'albie', 'win_big', 0)).not.toBeNull()
    expect(pickLine(wins, 'albie', 'win_big', 1)).not.toBeNull()
  })

  it('returns null for an event that personality has nothing for', () => {
    expect(pickLine(wins, 'albie', 'lose_big', 0.5)).toBeNull()
    expect(pickLine(wins, 'bernadette', 'win_big', 0.5)).toBeNull()
  })

  it('returns null for an empty pool or a personality with no matching lines', () => {
    expect(pickLine([], 'albie', 'win_big', 0.5)).toBeNull()
  })

  it('is deterministic across an identical call', () => {
    expect(pickLine(wins, 'albie', 'win_big', 0.37)).toEqual(
      pickLine(wins, 'albie', 'win_big', 0.37),
    )
  })
})

describe('coverage', () => {
  it('reports exactly the missing events and an empty array for a complete character', () => {
    const allEvents: VoiceLine[] = (
      [
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
      ] as VoiceEvent[]
    ).map((event, index) => line({ personalityId: 'albie', event, id: `albie_${event}_${index}` }))

    const complete = coverage(allEvents, [PERSONALITIES[0] as BotPersonality])
    expect(complete[0]?.missing).toEqual([])

    const partial: VoiceLine[] = [line({ personalityId: 'bernadette' })]
    const report = coverage(partial, [PERSONALITIES[1] as BotPersonality])
    expect(report[0]?.missing).toContain('win_big')
    expect(report[0]?.missing).not.toContain('greeting')
    expect(report[0]?.missing.length).toBe(ALL_EXCEPT_GREETING)
  })

  it('reports a personality that has no lines at all as missing everything', () => {
    const report = coverage([], PERSONALITIES)
    expect(report).toHaveLength(PERSONALITIES.length)
    expect(report[0]?.missing).toHaveLength(ALL_EVENT_COUNT)
  })
})

const ALL_EVENT_COUNT = 12
const ALL_EXCEPT_GREETING = ALL_EVENT_COUNT - 1
