import { awaitingHuman, type SessionStep } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { cloneView, formatAmount, orderedSeats, reduceStep } from './presentation.js'

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
    expect(formatAmount(87_250, true)).toBe('87.3K')
    expect(formatAmount(87_250, false)).toBe('87,250')
  })
})
