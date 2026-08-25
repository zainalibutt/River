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
  const blinds = record.stake.smallBlind + record.stake.bigBlind
  const frames: ReplayFrame[] = [
    {
      index: 0,
      street: 'preflop',
      label: 'Deal',
      potAfter: blinds,
      boardAfter: [],
      actingSeat: null,
    },
  ]

  let pot = blinds
  let street: Street = 'preflop'
  let currentBet = record.stake.bigBlind
  let committed = new Map<number, number>()
  seedBlinds(record, committed)

  for (const action of record.actions) {
    if (action.street !== street) {
      street = action.street
      currentBet = 0
      committed = new Map()
    }
    const contribution = committed.get(action.seat) ?? 0
    let extra = 0
    if (action.action.kind === 'raiseTo') {
      extra = Math.max(0, action.action.to - contribution)
      currentBet = action.action.to
      committed.set(action.seat, action.action.to)
    } else if (action.action.kind === 'call') {
      extra = Math.max(0, currentBet - contribution)
      committed.set(action.seat, Math.max(currentBet, contribution))
    } else if (action.action.kind === 'allIn') {
      extra = Math.max(0, currentBet - contribution)
      committed.set(action.seat, Math.max(currentBet, contribution))
    }
    pot += extra
    frames.push({
      index: frames.length,
      street,
      label: actionLabel(action),
      potAfter: pot,
      boardAfter: boardFor(record, street),
      actingSeat: action.seat,
    })
  }

  const settled = Math.max(settledPot(record), pot)
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

function settledPot(record: HandRecord): number {
  return record.results.reduce((sum, result) => sum + Math.abs(result.delta), 0)
}

function seedBlinds(record: HandRecord, committed: Map<number, number>): void {
  const small = record.seats[0]
  const big = record.seats[1]
  if (small !== undefined) {
    committed.set(small.seat, Math.min(record.stake.smallBlind, small.startingStack))
  }
  if (big !== undefined) {
    committed.set(big.seat, Math.min(record.stake.bigBlind, big.startingStack))
  }
}
