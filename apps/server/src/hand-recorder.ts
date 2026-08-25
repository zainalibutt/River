import type { Card, HandAction, HandRecord, HandSeatStart, Street, TurnAction } from '@river/engine'

export interface HandOpening {
  handNumber: number
  startedAtMs: number
  stake: { smallBlind: number; bigBlind: number }
  seats: HandSeatStart[]
  commit: string
}

export interface HandClosing {
  board: Card[]
  potSize: number
  /** Final stack per seat, keyed by the same seat index the opening used. */
  finalStacks: Map<number, number>
  showedSeats: ReadonlySet<number>
  revealedSeed: string | null
}

const DEFAULT_LIMIT = 24

/**
 * Records what actually happened in a hand.
 *
 * The room already knows every fact a history needs; what it lacked was
 * anywhere to put them. Everything here is captured from the authoritative
 * state at the moment it is true - starting stacks before the blinds are
 * taken, the pot before it is awarded, final stacks after the award - so a
 * record is never a reconstruction and never has to guess.
 *
 * A hand that begins and never settles is dropped rather than stored half
 * finished. A partial record is worse than no record, because it looks like
 * evidence.
 */
export class HandRecorder {
  private open: { opening: HandOpening; actions: HandAction[] } | null = null
  private readonly hands: HandRecord[] = []

  constructor(private readonly limit: number = DEFAULT_LIMIT) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('hand history limit must be a positive integer')
    }
  }

  /**
   * Open a hand. Any hand still open is dropped rather than kept, because a
   * hand that never settled has no result and a record without a result reads
   * as evidence of something that did not happen.
   */
  begin(opening: HandOpening): void {
    this.open = {
      opening: { ...opening, seats: opening.seats.map((seat) => ({ ...seat })) },
      actions: [],
    }
  }

  /** Ignored when no hand is open, so a stray action can never invent one. */
  record(seat: number, street: Street, action: TurnAction): void {
    if (this.open === null) return
    this.open.actions.push({ seat, street, action })
  }

  finish(closing: HandClosing): HandRecord | null {
    const open = this.open
    if (open === null) return null
    this.open = null

    const record: HandRecord = {
      handNumber: open.opening.handNumber,
      startedAtMs: open.opening.startedAtMs,
      stake: { ...open.opening.stake },
      seats: open.opening.seats.map((seat) => ({ ...seat })),
      actions: open.actions,
      board: [...closing.board],
      potSize: closing.potSize,
      results: open.opening.seats.map((seat) => ({
        seat: seat.seat,
        delta: (closing.finalStacks.get(seat.seat) ?? seat.startingStack) - seat.startingStack,
        showed: closing.showedSeats.has(seat.seat),
      })),
      commit: open.opening.commit,
      revealedSeed: closing.revealedSeed,
    }

    this.hands.push(record)
    while (this.hands.length > this.limit) this.hands.shift()
    return record
  }

  /** Most recent first, so a client can render without reversing. */
  recent(count = this.limit): readonly HandRecord[] {
    if (count <= 0) return []
    return this.hands.slice(-count).reverse()
  }
}
