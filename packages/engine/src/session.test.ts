import { describe, expect, it } from 'vitest'
import { STAKE_250_500 } from './config.js'
import {
  awaitingHuman,
  bustHand,
  huSeats,
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
      session.act(session.view().currentActorId ?? '', { kind: 'fold' })
      continue
    }
    session.act(session.view().currentActorId ?? '', action)
  }
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
    const snap = (session: SoloSession) => session.history().map((step) => JSON.stringify(step))
    expect(snap(first)).toEqual(snap(second))
  })

  it('replays the same board for the same seed', () => {
    const first = fixedSession()
    const second = fixedSession()
    first.start()
    second.start()
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
      stacks: { you: 100_000, p2: 60_000, p3: 120_000 },
    })
    const total = session.totalChips()
    session.start()
    expect(session.totalChips()).toBe(total)
    playUntilBetween(session)
    expect(session.totalChips()).toBe(total)
    const showdown = session
      .history()
      .filter(
        (step): step is Extract<typeof step, { kind: 'showdown' }> => step.kind === 'showdown',
      )
    if (showdown.length > 0) {
      const sums = showdown.map((step) => step.potAwards.reduce((sum, a) => sum + a.amount, 0))
      expect(sums[0]).toBeGreaterThan(0)
    }
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
    session.start()
    playUntilBetween(session)
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
    }
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
  })
})
