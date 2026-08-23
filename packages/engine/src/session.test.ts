import { describe, expect, it } from 'vitest'
import { STAKE_250_500 } from './config.js'
import {
  awaitingHuman,
  bustHand,
  deckOf,
  huSeats,
  nineSeats,
  showdownHand,
  splitPotHand,
  uncontestedWinHand,
} from './scenarios.js'
import type { TurnAction } from './session.js'
import { SoloSession } from './session.js'

function humanTurn(session: SoloSession): TurnAction | null {
  const legal = session.view().legal
  if (legal === null) return null
  if (legal.call.enabled) return { kind: 'call' }
  if (legal.check.enabled) return { kind: 'check' }
  return { kind: 'fold' }
}

function playUntilBetween(session: SoloSession): void {
  let safety = 100
  while (session.view().phase !== 'between' && safety-- > 0) {
    const action = humanTurn(session)
    if (action === null) {
      throw new Error('session stalled without a human action')
    }
    const result = session.act(session.view().currentActorId ?? '', action)
    if (!result.ok) throw new Error(result.message ?? 'human action failed')
  }
  if (session.view().phase !== 'between') throw new Error('session exceeded action safety limit')
}

function fixedSession(): SoloSession {
  return new SoloSession({
    seats: huSeats('novice'),
    rngSeed: 'replay-seed',
    stake: STAKE_250_500,
  })
}

describe('solo session', () => {
  it('is deterministic per seed and scripted actions', () => {
    const first = fixedSession()
    const second = fixedSession()
    first.start()
    second.start()
    playUntilBetween(first)
    playUntilBetween(second)
    const snap = (session: SoloSession) => session.history().map((step) => JSON.stringify(step))
    expect(snap(first)).toEqual(snap(second))
  })

  it('replays the same board for the same seed', () => {
    const first = fixedSession()
    const second = fixedSession()
    first.start()
    second.start()
    playUntilBetween(first)
    playUntilBetween(second)
    expect(first.view().board).toHaveLength(5)
    expect(first.view().board.map((c) => c.rank + c.suit)).toEqual(
      second.view().board.map((c) => c.rank + c.suit),
    )
  })

  it('conserves chips through a full hand to showdown', () => {
    const session = fixedSession()
    const total = session.totalChips()
    session.start()
    expect(session.totalChips()).toBe(total)
    playUntilBetween(session)
    expect(session.view().phase).toBe('between')
    expect(session.totalChips()).toBe(total)
  })

  it('conserve chips across multiple hands and a rebuy', () => {
    const session = new SoloSession({
      seats: huSeats('rookie'),
      rngSeed: 'multi',
      stake: STAKE_250_500,
      stacks: { you: 300, p2: 100_000 },
    })
    const base = session.totalChips()
    for (let i = 0; i < 3; i++) {
      session.start()
      playUntilBetween(session)
      expect(session.totalChips()).toBe(base)
    }
    session.rebuy('you')
    session.start()
    playUntilBetween(session)
    expect(session.totalChips()).toBe(base + STAKE_250_500.defaultBuyIn)
  })

  it('conserves chips through an all-in with side pots across three seats', () => {
    const session = new SoloSession({
      seats: [...huSeats('og'), { id: 'p3', name: 'OG 2', botSkill: 'og' }],
      rngSeed: 'sidepot',
      stake: STAKE_250_500,
      stacks: { you: 250, p2: 250, p3: 500 },
    })
    const total = session.totalChips()
    session.start()
    expect(session.totalChips()).toBe(total)
    const shove = session.act('you', { kind: 'allIn' })
    expect(shove.ok).toBe(true)
    expect(session.view().phase).toBe('between')
    expect(session.view().board).toHaveLength(5)
    expect(session.totalChips()).toBe(total)
    const showdown = session
      .history()
      .filter(
        (step): step is Extract<typeof step, { kind: 'showdown' }> => step.kind === 'showdown',
      )
    expect(showdown).toHaveLength(1)
    expect(showdown[0]?.potAwards.reduce((sum, award) => sum + award.amount, 0)).toBe(total)
  })

  it('leaks no bot hole cards before showdown', () => {
    const session = showdownHand()
    session.start()
    for (const seat of session.view().seats) {
      if (seat.isBot) {
        expect(seat.hole).toBeNull()
      }
    }
    expect(session.view().revealed).toBe(false)
    playUntilBetween(session)
    expect(session.view().phase).toBe('between')
  })

  it('shows bot hole cards only after a showdown reveal', () => {
    const session = showdownHand()
    session.start()
    playUntilBetween(session)
    const revealedBot = session.view().seats.find((seat) => seat.isBot && seat.hole !== null)
    expect(revealedBot).toBeDefined()
  })

  it('awards a split pot to both winners with equal ranks', () => {
    const session = splitPotHand()
    session.start()
    playUntilBetween(session)
    const awards = session
      .history()
      .filter(
        (step): step is Extract<typeof step, { kind: 'showdown' }> => step.kind === 'showdown',
      )
      .flatMap((step) => step.potAwards)
    expect(awards).toHaveLength(2)
    expect(awards[0]?.amount).toBe(awards[1]?.amount)
  })

  it('crowns an uncontested winner without a showdown', () => {
    const session = uncontestedWinHand()
    session.start()
    const actor = session.view().currentActorId ?? 'you'
    const shove = session.act(actor, { kind: 'allIn' })
    expect(shove.ok).toBe(true)
    playUntilBetween(session)
    expect(session.history().some((step) => step.kind === 'uncontested')).toBe(true)
    expect(session.history().some((step) => step.kind === 'showdown')).toBe(false)
  })

  it('busts a seat that loses its last chips and allows a rebuy', () => {
    const session = bustHand()
    const startSteps = session.start()
    expect(startSteps.filter((step) => step.kind === 'await')).toHaveLength(1)
    const runout = session.act('you', { kind: 'call' })
    expect(runout.ok).toBe(true)
    expect(session.view().phase).toBe('between')
    expect(session.view().board).toHaveLength(5)
    expect(runout.steps.filter((step) => step.kind === 'await')).toHaveLength(0)
    expect(session.view().seats.some((seat) => seat.busted)).toBe(true)
    expect(session.rebuy('p2', STAKE_250_500.defaultBuyIn)).toBe(true)
    expect(session.view().seats.find((seat) => seat.id === 'p2')?.busted).toBe(false)
  })

  it('rejects actions out of order and below minimum raises', () => {
    const session = awaitingHuman()
    session.start()
    const out = session.act('someone-else', { kind: 'fold' })
    expect(out.ok).toBe(false)
    const pending = session.view().legal
    if (pending !== null) {
      const actor = session.view().currentActorId ?? 'you'
      const below = session.act(actor, { kind: 'raiseTo', to: pending.raiseTo.min - 1 })
      expect(below.ok).toBe(false)
      expect(below.message).toMatch(/minimum/i)
    }
  })

  it('clamps a short call and disables an unreachable raise', () => {
    const session = new SoloSession({
      seats: huSeats('rookie'),
      rngSeed: 'short-call',
      stake: STAKE_250_500,
      stacks: { you: 300, p2: 100_000 },
      fixedDeck: deckOf('As 2c 7d 3h 4h 5h 6h 9c Qd'),
    })
    session.start()
    const legal = session.view().legal
    expect(session.view().currentActorId).toBe('you')
    expect(legal?.call).toEqual({ enabled: true, amount: 50 })
    expect(legal?.raiseTo.enabled).toBe(false)
    expect(legal?.allIn).toEqual({ enabled: true, amount: 300 })
  })

  it('does not count a hand when fewer than two players can be dealt', () => {
    const session = new SoloSession({
      seats: huSeats('rookie'),
      rngSeed: 'not-enough',
      stacks: { you: 1000, p2: 0 },
    })
    expect(session.start()).toEqual([
      { kind: 'notice', message: 'Not enough seated players to deal a hand.' },
    ])
    expect(session.view().handNumber).toBe(0)
  })

  it('supports a nine-seat projection without leaking bot cards', () => {
    const session = new SoloSession({
      seats: nineSeats('novice'),
      rngSeed: 'nine-seat',
    })
    session.start()
    expect(session.view().seats).toHaveLength(9)
    expect(
      session
        .view()
        .seats.filter((seat) => seat.isBot)
        .every((seat) => seat.hole === null),
    ).toBe(true)
  })

  it('terminates deterministically across skills, seeds, and table sizes', () => {
    for (const skill of ['rookie', 'novice', 'og'] as const) {
      for (const seats of [huSeats(skill), nineSeats(skill)]) {
        for (let seed = 0; seed < 5; seed++) {
          const session = new SoloSession({ seats, rngSeed: `${skill}-${seats.length}-${seed}` })
          const total = session.totalChips()
          session.start()
          playUntilBetween(session)
          expect(session.totalChips()).toBe(total)
        }
      }
    }
  })

  it('skips an empty seat when rotating the dealer', () => {
    const session = new SoloSession({
      seats: [
        { id: 'you', name: 'You', botSkill: null },
        { id: 'empty', name: 'Empty', botSkill: 'rookie' },
        { id: 'p3', name: 'Rookie', botSkill: 'rookie' },
      ],
      rngSeed: 'dealer-skip',
      stacks: { you: 100_000, empty: 0, p3: 100_000 },
    })
    session.start()
    playUntilBetween(session)
    const next = session.start()
    expect(next.find((step) => step.kind === 'handStarted')).toMatchObject({ dealerId: 'p3' })
  })

  it('restores configured stacks and ready state on reset', () => {
    const session = new SoloSession({
      seats: huSeats('rookie'),
      rngSeed: 'reset',
      stacks: { you: 12_000, p2: 34_000 },
    })
    session.start()
    session.reset()
    expect(session.view().phase).toBe('ready')
    expect(session.view().street).toBe('preflop')
    expect(session.view().handNumber).toBe(0)
    expect(session.view().seats.map((seat) => seat.stack)).toEqual([12_000, 34_000])
  })

  it('rejects duplicate ids and tables above nine seats', () => {
    expect(
      () =>
        new SoloSession({
          seats: [
            { id: 'same', name: 'One', botSkill: null },
            { id: 'same', name: 'Two', botSkill: 'rookie' },
          ],
          rngSeed: 'duplicate',
        }),
    ).toThrow(/unique/)
    expect(
      () =>
        new SoloSession({
          seats: Array.from({ length: 10 }, (_, index) => ({
            id: `p${index}`,
            name: `Player ${index}`,
            botSkill: index === 0 ? null : ('rookie' as const),
          })),
          rngSeed: 'too-many',
        }),
    ).toThrow(/at most 9/)
  })

  it('returns view snapshots that cannot mutate session cards', () => {
    const session = awaitingHuman()
    session.start()
    const first = session.view()
    const original = first.seats.find((seat) => seat.id === 'you')?.hole?.[0]?.rank
    const exposed = first.seats.find((seat) => seat.id === 'you')?.hole?.[0]
    if (exposed !== undefined) exposed.rank = original === 'A' ? 'K' : 'A'
    expect(session.view().seats.find((seat) => seat.id === 'you')?.hole?.[0]?.rank).toBe(original)
  })

  it('emits blind and board steps in order', () => {
    const session = showdownHand()
    const steps = session.start()
    const kinds = steps.map((step) => step.kind)
    expect(kinds).toContain('handStarted')
    expect(kinds).toContain('blind')
    expect(kinds).toContain('await')
    while (session.view().phase !== 'between') {
      const action = humanTurn(session) ?? { kind: 'fold' }
      const result = session.act(session.view().currentActorId ?? '', action)
      if (!result.ok) break
    }
    const boardSteps = session.history().filter((step) => step.kind === 'board')
    expect(boardSteps.length).toBeGreaterThanOrEqual(3)
    const kindsInHistory = session.history().map((step) => step.kind)
    expect(kindsInHistory.indexOf('action')).toBeLessThan(kindsInHistory.indexOf('board'))
  })
})
