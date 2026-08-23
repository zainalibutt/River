import type { SessionStep, SoloTableView, ViewSeat } from '@river/engine'

export function cloneView(view: SoloTableView): SoloTableView {
  return {
    ...view,
    board: view.board.map((card) => ({ ...card })),
    seats: view.seats.map((seat) => ({
      ...seat,
      hole: seat.hole?.map((card) => ({ ...card })) ?? null,
    })),
    legal:
      view.legal === null
        ? null
        : {
            fold: { ...view.legal.fold },
            check: { ...view.legal.check },
            call: { ...view.legal.call },
            raiseTo: { ...view.legal.raiseTo },
            allIn: { ...view.legal.allIn },
          },
  }
}

function seatById(view: SoloTableView, id: string): ViewSeat | undefined {
  return view.seats.find((seat) => seat.id === id)
}

function pay(view: SoloTableView, seat: ViewSeat, amount: number): number {
  const paid = Math.max(0, Math.min(amount, seat.stack))
  seat.stack -= paid
  seat.betStreet += paid
  seat.betHand += paid
  view.pot += paid
  if (seat.stack === 0) seat.allIn = true
  return paid
}

export function reduceStep(
  current: SoloTableView,
  step: SessionStep,
  after: SoloTableView,
): SoloTableView {
  const next = cloneView(current)
  switch (step.kind) {
    case 'notice':
      next.message = step.message
      return next
    case 'handStarted':
      next.phase = 'hand'
      next.handNumber = step.handNumber
      next.street = 'preflop'
      next.board = []
      next.pot = 0
      next.currentBet = 0
      next.currentActorId = null
      next.legal = null
      next.commit = step.commit
      next.message = null
      next.revealed = false
      next.seats = next.seats.map((seat) => {
        const target = seatById(after, seat.id)
        return {
          ...seat,
          betHand: 0,
          betStreet: 0,
          folded: false,
          allIn: false,
          dealer: seat.id === step.dealerId,
          hasHole: target?.hasHole ?? false,
          hole:
            target?.isBot === false ? (target.hole?.map((card) => ({ ...card })) ?? null) : null,
        }
      })
      return next
    case 'blind': {
      const seat = seatById(next, step.seatId)
      if (seat !== undefined) {
        pay(next, seat, step.amount)
        next.currentBet = Math.max(next.currentBet, seat.betStreet)
      }
      return next
    }
    case 'action': {
      const seat = seatById(next, step.seatId)
      next.currentActorId = null
      next.legal = null
      if (seat === undefined) return next
      switch (step.decision.kind) {
        case 'fold':
          seat.folded = true
          break
        case 'check':
          break
        case 'call':
          pay(next, seat, Math.max(0, next.currentBet - seat.betStreet))
          break
        case 'raiseTo':
          pay(next, seat, Math.max(0, step.decision.to - seat.betStreet))
          next.currentBet = Math.max(next.currentBet, step.decision.to)
          break
        case 'allIn':
          pay(next, seat, seat.stack)
          next.currentBet = Math.max(next.currentBet, seat.betStreet)
          break
      }
      return next
    }
    case 'board':
      next.street = step.street
      next.board.push(...step.cards.map((card) => ({ ...card })))
      next.currentBet = 0
      next.seats = next.seats.map((seat) => ({ ...seat, betStreet: 0 }))
      return next
    case 'await':
      next.currentActorId = step.seatId
      next.legal = {
        fold: { ...step.legal.fold },
        check: { ...step.legal.check },
        call: { ...step.legal.call },
        raiseTo: { ...step.legal.raiseTo },
        allIn: { ...step.legal.allIn },
      }
      return next
    case 'uncontested': {
      const winner = seatById(next, step.seatId)
      if (winner !== undefined) winner.stack += step.amount
      next.pot = Math.max(0, next.pot - step.amount)
      next.message = `${winner?.name ?? 'Player'} wins ${formatAmount(step.amount, false)}`
      return next
    }
    case 'showdown':
      next.revealed = true
      next.seats = next.seats.map((seat) => {
        const target = seatById(after, seat.id)
        const amount = step.potAwards
          .filter((award) => award.seatId === seat.id)
          .reduce((sum, award) => sum + award.amount, 0)
        return {
          ...seat,
          stack: seat.stack + amount,
          hole: target?.hole?.map((card) => ({ ...card })) ?? seat.hole,
        }
      })
      next.pot = 0
      next.message = outcomeMessage(step, next)
      return next
    case 'bust': {
      const seat = seatById(next, step.seatId)
      if (seat !== undefined) seat.busted = true
      return next
    }
    case 'between':
      next.phase = 'between'
      next.currentActorId = null
      next.legal = null
      next.countdownMs = step.countdownMs
      return next
  }
}

function outcomeMessage(
  step: Extract<SessionStep, { kind: 'showdown' }>,
  view: SoloTableView,
): string {
  const totals = new Map<string, number>()
  for (const award of step.potAwards) {
    totals.set(award.seatId, (totals.get(award.seatId) ?? 0) + award.amount)
  }
  if (totals.size > 1) return 'Split pot'
  const [winnerId, amount] = totals.entries().next().value ?? ['you', 0]
  return `${seatById(view, winnerId)?.name ?? 'Player'} wins ${formatAmount(amount, false)}`
}

export function formatAmount(value: number, abbreviated: boolean): string {
  if (!abbreviated || value < 10_000) return value.toLocaleString('en-GB')
  const divisor = value >= 1_000_000 ? 1_000_000 : 1_000
  const suffix = divisor === 1_000_000 ? 'M' : 'K'
  return `${(value / divisor).toFixed(1).replace(/\.0$/, '')}${suffix}`
}

export function orderedSeats(view: SoloTableView): ViewSeat[] {
  const heroIndex = view.seats.findIndex((seat) => !seat.isBot)
  if (heroIndex < 0) return view.seats
  return [...view.seats.slice(heroIndex), ...view.seats.slice(0, heroIndex)]
}

export function dwellFor(step: SessionStep, view: SoloTableView): number {
  switch (step.kind) {
    case 'handStarted':
      return 400
    case 'blind':
      return 180
    case 'action':
      return seatById(view, step.seatId)?.isBot ? 700 : 0
    case 'board':
      return step.street === 'flop' ? 520 : 340
    case 'uncontested':
      return 900
    case 'showdown':
      return 1400
    case 'bust':
      return 700
    case 'notice':
      return 900
    default:
      return 0
  }
}
