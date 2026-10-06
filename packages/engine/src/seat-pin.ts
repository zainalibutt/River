import type { SeatMood } from './seat-presentation.js'
import type { TurnClock } from './turn-clock.js'

export type SeatPinKind = 'none' | 'glyph' | 'amount' | 'clock'

export interface SeatPin {
  kind: SeatPinKind
  glyph: 'check' | 'fold' | 'away' | 'sittingOut' | null
  amount: number | null
  fraction: number | null
  urgent: boolean
}

export interface SeatPinInput {
  mood: SeatMood
  /** Chips committed this street. Zero is not a bet. */
  committed: number
  /** Whether this is the seat currently acting. */
  isActing: boolean
  clock: TurnClock | null
}

const NONE: SeatPin = {
  kind: 'none',
  glyph: null,
  amount: null,
  fraction: null,
  urgent: false,
}

export function seatPin(input: SeatPinInput): SeatPin {
  if (input.isActing) {
    if (input.clock === null) return NONE
    return {
      kind: 'clock',
      glyph: null,
      amount: null,
      fraction: input.clock.fraction,
      urgent: input.clock.urgent,
    }
  }
  if (input.committed > 0) {
    return { ...NONE, kind: 'amount', amount: input.committed }
  }
  const glyph = glyphForMood(input.mood)
  if (glyph !== null) {
    return { ...NONE, kind: 'glyph', glyph }
  }
  return NONE
}

function glyphForMood(mood: SeatMood): 'check' | 'fold' | 'away' | 'sittingOut' | null {
  switch (mood) {
    case 'folded':
      return 'fold'
    case 'away':
      return 'away'
    case 'sittingOut':
      return 'sittingOut'
    case 'allIn':
      return 'check'
    default:
      return null
  }
}
