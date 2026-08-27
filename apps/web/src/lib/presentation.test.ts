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
