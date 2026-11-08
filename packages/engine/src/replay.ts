import type { Street } from './betting.js'
import type { Card } from './cards.js'
import type { HandAction, HandRecord } from './hand-history.js'

export interface ReplayFrame {
  index: number
  street: Street
  label: string
  potAfter: number
  boardAfter: Card[]
  actingSeat: number | null
}

const CARDS_BY_STREET: Record<Street, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
}

export function buildReplay(record: HandRecord): readonly ReplayFrame[] {
  const first = record.actions[0]
  // The table records what each action actually put in and the pot before it,
  // so a recorded hand is replayed from those: an all in carries no amount of
  // its own, a short stack calls for less than the bet, and blinds are posted
  // by position, which the seat list does not say. Older records without the
  // amounts fall back to working them out.
  const recorded =
    first?.potBefore !== undefined &&
    record.actions.every((entry) => entry.amountCommitted !== undefined)
  const inferred = recorded ? null : inferAmounts(record)
  const startPot =
    first?.potBefore !== undefined && recorded ? first.potBefore : (inferred?.blinds ?? 0)
  const frames: ReplayFrame[] = [
    {
      index: 0,
      street: 'preflop',
      label: 'Deal',
      potAfter: startPot,
      boardAfter: [],
      actingSeat: null,
    },
  ]

  const amounts = inferred?.amounts ?? record.actions.map((entry) => entry.amountCommitted ?? 0)
  let pot = startPot
  let street: Street = 'preflop'
  record.actions.forEach((action, index) => {
    street = action.street
    pot += amounts[index] ?? 0
    frames.push({
      index: frames.length,
      street,
      label: actionLabel(action),
      potAfter: pot,
      boardAfter: boardFor(record, street),
      actingSeat: action.seat,
    })
  })

  const settled = record.potSize > 0 ? record.potSize : pot
  frames.push({
    index: frames.length,
    street,
    label: `Pot settled at ${formatChips(settled)}`,
    potAfter: settled,
    boardAfter: boardFor(record, street),
    actingSeat: null,
  })
  return frames
}

/**
 * Chips each action put in, for a record that does not say. Capped by what the
 * seat had left, so an all in is the rest of the stack and a short call is
 * what the caller could cover. Blinds are assumed posted by the first two
 * seats listed, which is only right when that is where they sat.
 */
function inferAmounts(record: HandRecord): { blinds: number; amounts: number[] } {
  const left = new Map(record.seats.map((seat) => [seat.seat, seat.startingStack]))
  let committed = new Map<number, number>()
  const post = (seat: number | undefined, blind: number) => {
    if (seat === undefined) return
    const amount = Math.min(blind, left.get(seat) ?? 0)
    committed.set(seat, amount)
    left.set(seat, (left.get(seat) ?? 0) - amount)
  }
  post(record.seats[0]?.seat, record.stake.smallBlind)
  post(record.seats[1]?.seat, record.stake.bigBlind)
  const blinds = [...committed.values()].reduce((sum, amount) => sum + amount, 0)
  // A short big blind does not lower the bet: a covering caller still owes the
  // full blind, as the betting engine has it.
  let currentBet = record.stake.bigBlind
  let street: Street = 'preflop'
  const amounts = record.actions.map((action) => {
    if (action.street !== street) {
      street = action.street
      currentBet = 0
      committed = new Map()
    }
    const before = committed.get(action.seat) ?? 0
    const stack = left.get(action.seat) ?? 0
    let extra = 0
    if (action.action.kind === 'raiseTo') extra = action.action.to - before
    else if (action.action.kind === 'call') extra = currentBet - before
    else if (action.action.kind === 'allIn') extra = stack
    extra = Math.min(stack, Math.max(0, extra))
    committed.set(action.seat, before + extra)
    left.set(action.seat, stack - extra)
    currentBet = Math.max(currentBet, before + extra)
    return extra
  })
  return { blinds, amounts }
}

export function frameAt(frames: readonly ReplayFrame[], index: number): ReplayFrame | null {
  if (frames.length === 0) return null
  if (index <= 0) return frames[0] ?? null
  if (index >= frames.length - 1) return frames[frames.length - 1] ?? null
  return frames[index] ?? null
}

export function streetBoundaries(frames: readonly ReplayFrame[]): readonly number[] {
  const boundaries: number[] = []
  let previous: Street | null = null
  for (const frame of frames) {
    if (frame.street !== previous) {
      boundaries.push(frame.index)
      previous = frame.street
    }
  }
  return boundaries
}

function actionLabel(action: HandAction): string {
  const seat = `Seat ${action.seat}`
  switch (action.action.kind) {
    case 'raiseTo':
      return `${seat} raises to ${formatChips(action.action.to)}`
    case 'call':
      return `${seat} calls`
    case 'check':
      return `${seat} checks`
    case 'fold':
      return `${seat} folds`
    case 'allIn':
      return `${seat} goes all in`
  }
}

function formatChips(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(amount)))
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function boardFor(record: HandRecord, street: Street): Card[] {
  return record.board.slice(0, CARDS_BY_STREET[street])
}
