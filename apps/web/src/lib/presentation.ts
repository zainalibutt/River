import type {
  BotDecision,
  BotSkill,
  Card,
  SessionStep,
  SoloTableView,
  TurnAction,
  ViewSeat,
} from '@river/engine'
import { formatChips } from '@river/engine'

/**
 * A rank as a player reads it. The engine writes a ten as T, which is poker notation; a card
 * on the table says 10.
 */
export function rankLabel(rank: Card['rank']): string {
  return rank === 'T' ? '10' : rank
}

const BOT_DWELL: Record<BotSkill, { min: number; max: number; aggression: number }> = {
  rookie: { min: 400, max: 800, aggression: 0 },
  novice: { min: 600, max: 1200, aggression: 0 },
  og: { min: 800, max: 1600, aggression: 600 },
}

const FOLD_RELIEF = 200
const MIN_DWELL = 250

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

/**
 * A chip count, for the HUD.
 *
 * `abbreviated` means "somebody else's money": another player's stack is short
 * form, your own is shown in full. The short-form rules themselves live in the
 * engine now, because the world-space pins beside each seat need exactly the
 * same ones and the alternative was importing this module into the 3D scene or
 * writing them a second time.
 *
 * The engine also carries two decimals where this carried one. Two is what the
 * reference uses - 22.07K, 8.73K, 4.68K - and a stack that jumps by a hundred
 * chips should visibly change.
 *
 * With `bigBlind`, the amount is shown in the table's big blinds instead, for a
 * player who has asked for that in Settings. Every amount at the table comes
 * through here, so the whole table changes together; the stake itself is not
 * an amount and keeps reading 250/500.
 */
export function formatAmount(
  value: number,
  abbreviated: boolean,
  bigBlind: number | null = null,
): string {
  if (bigBlind !== null && bigBlind > 0) return formatBigBlinds(value, bigBlind)
  if (!abbreviated) return Math.trunc(value).toLocaleString('en-GB')
  return formatChips(value)
}

/** From this many big blinds up an amount is shown whole; under it, to one decimal place. */
const WHOLE_BLINDS_FROM = 10

/**
 * 4,000 at 250/500 is 8 BB, 1,843 is 3.7 BB and 100,000 is 200 BB.
 *
 * Worked in tenths of a big blind from the whole chip count, so a half rounds
 * up the way it reads: 1,825 is 3.65 big blinds, which a float holds as
 * 3.6499, and it shows as 3.7. A trailing .0 is dropped, so 4,990 reads 10 BB.
 */
function formatBigBlinds(value: number, bigBlind: number): string {
  const chips = Number.isFinite(value) ? Math.abs(Math.trunc(value)) : 0
  const tenths =
    chips < WHOLE_BLINDS_FROM * bigBlind
      ? Math.round((chips * 10) / bigBlind)
      : Math.round(chips / bigBlind) * 10
  if (tenths === 0) return '0 BB'
  const whole = Math.trunc(tenths / 10).toLocaleString('en-GB')
  const tenth = tenths % 10
  return `${value < 0 ? '-' : ''}${whole}${tenth === 0 ? '' : `.${tenth}`} BB`
}

export function orderedSeats(view: SoloTableView): ViewSeat[] {
  const heroIndex = view.seats.findIndex((seat) => !seat.isBot)
  if (heroIndex < 0) return view.seats
  return [...view.seats.slice(heroIndex), ...view.seats.slice(0, heroIndex)]
}

export function botDwell(
  decision: BotDecision | TurnAction,
  skill: BotSkill,
  sample: () => number = Math.random,
): number {
  const range = BOT_DWELL[skill]
  const base = range.min + sample() * (range.max - range.min)
  const aggressive = decision.kind === 'raiseTo' || decision.kind === 'allIn'
  const relief = decision.kind === 'fold' ? FOLD_RELIEF : 0
  return Math.max(MIN_DWELL, Math.round(base + (aggressive ? range.aggression : 0) - relief))
}

export function dwellFor(
  step: SessionStep,
  view: SoloTableView,
  skill: BotSkill,
  sample: () => number = Math.random,
): number {
  switch (step.kind) {
    case 'handStarted':
      return 400
    case 'blind':
      return 180
    case 'action':
      return seatById(view, step.seatId)?.isBot ? botDwell(step.decision, skill, sample) : 0
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
