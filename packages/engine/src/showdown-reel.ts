import type { HandRecord } from './hand-history.js'
import { describeShowdown } from './hand-narrative.js'
import { revealOrder } from './showdown-order.js'

export type ShowdownBeat =
  | { kind: 'reveal'; seat: number; atMs: number; holdMs: number }
  | { kind: 'name'; seat: number; hand: string; atMs: number; holdMs: number }
  | { kind: 'award'; seat: number; amount: number; atMs: number; holdMs: number }

export interface ShowdownReel {
  beats: ShowdownBeat[]
  totalMs: number
}

export interface ReelOptions {
  revealHoldMs?: number
  nameHoldMs?: number
  awardHoldMs?: number
}

export interface ShowdownInput {
  record: HandRecord
}

const DEFAULT_REVEAL_HOLD_MS = 900
const DEFAULT_NAME_HOLD_MS = 1000
const DEFAULT_AWARD_HOLD_MS = 1400

export function showdownReel(input: ShowdownInput, options?: ReelOptions): ShowdownReel {
  const revealHold = options?.revealHoldMs ?? DEFAULT_REVEAL_HOLD_MS
  const nameHold = options?.nameHoldMs ?? DEFAULT_NAME_HOLD_MS
  const awardHold = options?.awardHoldMs ?? DEFAULT_AWARD_HOLD_MS
  const beats: ShowdownBeat[] = []
  let cursor = 0

  const shownSeats = new Set(
    input.record.results.filter((result) => result.showed).map((result) => result.seat),
  )
  const winners = input.record.results
    .filter((result) => result.delta > 0)
    .sort((a, b) => a.seat - b.seat)

  const showOrder = revealOrder(
    input.record.seats.map((seat) => ({
      seat: seat.seat,
      folded: false,
      allIn: false,
      handRank: null,
      lastAggressorOnRiver: false,
    })),
  )
  const ordered = showOrder.filter((step) => shownSeats.has(step.seat)).map((step) => step.seat)

  for (const seat of ordered) {
    beats.push({ kind: 'reveal', seat, atMs: cursor, holdMs: revealHold })
    cursor += revealHold
    const name = handNameFor(seat)
    if (name !== null) {
      beats.push({ kind: 'name', seat, hand: name, atMs: cursor, holdMs: nameHold })
      cursor += nameHold
    }
  }

  for (const winner of winners) {
    beats.push({
      kind: 'award',
      seat: winner.seat,
      amount: winner.delta,
      atMs: cursor,
      holdMs: awardHold,
    })
    cursor += awardHold
  }

  return { beats, totalMs: cursor }

  function handNameFor(seat: number): string | null {
    const lines = describeShowdown(input.record)
    const line = lines.find((entry) => entry.seat === seat)
    return line?.hand ?? null
  }
}
