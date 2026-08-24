import type { Street } from './betting.js'
import type { Card } from './cards.js'
import type { TurnAction } from './session.js'

export interface HandSeatStart {
  seat: number
  playerId: string
  startingStack: number
}

export interface HandAction {
  seat: number
  street: Street
  action: TurnAction
}

export interface HandSeatResult {
  seat: number
  delta: number
  showed: boolean
}

export interface HandRecord {
  handNumber: number
  startedAtMs: number
  stake: { smallBlind: number; bigBlind: number }
  seats: HandSeatStart[]
  actions: HandAction[]
  board: Card[]
  results: HandSeatResult[]
  commit: string
  revealedSeed: string | null
}

export interface HandSummary {
  winnerSeats: number[]
  finalStreet: Street | null
  potSize: number
  wentToShowdown: boolean
  actionCount: number
}

const STREET_ORDER: readonly Street[] = ['preflop', 'flop', 'turn', 'river']

export function summariseHand(record: HandRecord): HandSummary {
  let finalStreet: Street | null = null
  for (const action of record.actions) {
    if (finalStreet === null || streetIndex(action.street) > streetIndex(finalStreet)) {
      finalStreet = action.street
    }
  }
  const winnerSeats = record.results
    .filter((result) => result.delta > 0)
    .map((result) => result.seat)
  const potSize = record.results.reduce((sum, result) => sum + Math.abs(result.delta), 0)
  const wentToShowdown = record.results.some((result) => result.showed)
  return {
    winnerSeats,
    finalStreet,
    potSize,
    wentToShowdown,
    actionCount: record.actions.length,
  }
}

function streetIndex(street: Street): number {
  return STREET_ORDER.indexOf(street)
}

export function conservesChips(record: HandRecord): boolean {
  return record.results.reduce((sum, result) => sum + result.delta, 0) === 0
}

export function formatHandLine(record: HandRecord, seat: number): string {
  const summary = summariseHand(record)
  const identity = seatIdentity(record, seat)
  const result = record.results.find((entry) => entry.seat === seat)
  const outcome =
    result === undefined
      ? 'no result'
      : result.delta > 0
        ? `won ${result.delta}`
        : result.delta < 0
          ? `lost ${-result.delta}`
          : 'broke even'
  return `Hand ${record.handNumber} (${summary.finalStreet ?? 'preflop'}): ${identity} ${outcome}`
}

function seatIdentity(record: HandRecord, seat: number): string {
  const named = record.seats.find((entry) => entry.seat === seat)
  return named !== undefined && named.playerId.length > 0 ? named.playerId : `seat ${seat}`
}
