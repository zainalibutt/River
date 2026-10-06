import { awaitingHuman, type SessionStep } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  botDwell,
  cloneView,
  dwellFor,
  formatAmount,
  orderedSeats,
  reduceStep,
} from './presentation.js'

describe('presentation reducer', () => {
  it('reconciles a complete hand to the engine projection', () => {
    const session = awaitingHuman()
    let shown = cloneView(session.view())
    const start = session.start()
    const started = session.view()
    for (const step of start) shown = reduceStep(shown, step, started)
    const result = session.act('you', { kind: 'call' })
    expect(result.ok).toBe(true)
    const after = session.view()
    for (const step of result.steps) shown = reduceStep(shown, step, after)
    expect(shown.phase).toBe(after.phase)
    expect(shown.board).toEqual(after.board)
    expect(shown.pot).toBe(after.pot)
    expect(shown.seats.map(({ stack }) => stack)).toEqual(after.seats.map(({ stack }) => stack))
  })

  it('groups showdown awards and reveals only at showdown', () => {
    const session = awaitingHuman()
    const before = session.view()
    const after = cloneView(before)
    const opponent = after.seats[1]
    if (opponent === undefined) throw new Error('opponent fixture missing')
    after.seats[1] = {
      ...opponent,
      hole: [
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 's' },
      ],
    }
    const step: SessionStep = {
      kind: 'showdown',
      potAwards: [
        { seatId: 'p2', amount: 500 },
        { seatId: 'p2', amount: 250 },
      ],
    }
    const shown = reduceStep(before, step, after)
    expect(shown.seats[1]?.stack).toBe((before.seats[1]?.stack ?? 0) + 750)
    expect(shown.seats[1]?.hole).toEqual(after.seats[1]?.hole)
  })

  it('formats money and rotates the hero to position zero', () => {
    const session = awaitingHuman()
    const view = session.view()
    view.seats.reverse()
    expect(orderedSeats(view)[0]?.id).toBe('you')
    // Two decimals, not one: the reference writes 22.07K and 8.73K, and a
    // stack moving by a hundred chips should visibly change.
    expect(formatAmount(87_250, true)).toBe('87.25K')
    expect(formatAmount(87_250, false)).toBe('87,250')
  })
})

describe('amounts in big blinds', () => {
  // The table's stake, 250/500.
  const bigBlind = 500

  it('writes the amounts the setting was specified with', () => {
    expect(formatAmount(4_000, false, bigBlind)).toBe('8 BB')
    expect(formatAmount(1_843, false, bigBlind)).toBe('3.7 BB')
    expect(formatAmount(100_000, false, bigBlind)).toBe('200 BB')
  })

  it('keeps one decimal under ten big blinds and whole numbers from ten up', () => {
    expect(formatAmount(250, false, bigBlind)).toBe('0.5 BB')
    expect(formatAmount(4_750, false, bigBlind)).toBe('9.5 BB')
    expect(formatAmount(5_000, false, bigBlind)).toBe('10 BB')
    expect(formatAmount(5_240, false, bigBlind)).toBe('10 BB')
    expect(formatAmount(5_250, false, bigBlind)).toBe('11 BB')
    expect(formatAmount(87_250, false, bigBlind)).toBe('175 BB')
  })

  it('drops a trailing .0, including where rounding reaches ten', () => {
    expect(formatAmount(500, false, bigBlind)).toBe('1 BB')
    expect(formatAmount(4_990, false, bigBlind)).toBe('10 BB')
    expect(formatAmount(0, false, bigBlind)).toBe('0 BB')
  })

  it('rounds a half up from the whole chip count, not from a float', () => {
    // 1,825 is 3.65 big blinds, which a float holds as 3.6499...
    expect(formatAmount(1_825, false, bigBlind)).toBe('3.7 BB')
    expect(formatAmount(75, false, bigBlind)).toBe('0.2 BB')
  })

  it('reads the same whether the chip count would have been shortened or not', () => {
    expect(formatAmount(87_250, true, bigBlind)).toBe('175 BB')
    expect(formatAmount(1_843, true, bigBlind)).toBe('3.7 BB')
  })

  it('groups a large count and keeps the sign of a loss', () => {
    expect(formatAmount(1_000_000, false, bigBlind)).toBe('2,000 BB')
    expect(formatAmount(-1_843, false, bigBlind)).toBe('-3.7 BB')
    expect(formatAmount(-10, false, bigBlind)).toBe('0 BB')
  })

  it('shows chips exactly as before without a big blind', () => {
    expect(formatAmount(87_250, true, null)).toBe('87.25K')
    expect(formatAmount(87_250, false, null)).toBe('87,250')
    expect(formatAmount(87_250, true)).toBe('87.25K')
  })
})

describe('bot pacing', () => {
  it('separates tiers and pauses OG before aggression', () => {
    const mid = () => 0.5
    expect(botDwell({ kind: 'call' }, 'rookie', mid)).toBe(600)
    expect(botDwell({ kind: 'call' }, 'novice', mid)).toBe(900)
    expect(botDwell({ kind: 'call' }, 'og', mid)).toBe(1200)
    expect(botDwell({ kind: 'raiseTo', to: 4000 }, 'og', mid)).toBe(1800)
    expect(botDwell({ kind: 'allIn' }, 'og', mid)).toBe(1800)
  })

  it('folds quicker and never drops below the floor', () => {
    const low = () => 0
    expect(botDwell({ kind: 'fold' }, 'rookie', low)).toBe(250)
    expect(botDwell({ kind: 'fold' }, 'og', low)).toBe(600)
    expect(botDwell({ kind: 'fold' }, 'novice', () => 0.5)).toBe(700)
  })

  it('leaves hero actions instant', () => {
    const session = awaitingHuman()
    const view = session.view()
    const step: SessionStep = { kind: 'action', seatId: 'you', decision: { kind: 'call' } }
    expect(dwellFor(step, view, 'og', () => 0.5)).toBe(0)
  })
})
