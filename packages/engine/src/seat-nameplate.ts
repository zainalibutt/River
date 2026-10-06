import { progressFor } from './rep-progression.js'

export interface NameplateInput {
  seat: number
  playerId: string | null
  name: string | null
  stack: number
  rep: number
  folded: boolean
  sittingOut: boolean
  disconnected: boolean
}

export interface Nameplate {
  seat: number
  name: string
  stack: number
  rank: string
  rankIndex: number
  note: 'folded' | 'sitting out' | 'reconnecting' | null
}

export function nameplate(input: NameplateInput): Nameplate | null {
  if (input.playerId === null) return null
  const settledName = input.name === null ? fallbackName(input.seat) : input.name
  const safeName = settledName.length > 0 ? settledName : fallbackName(input.seat)
  const progress = progressFor(input.rep)
  return {
    seat: input.seat,
    name: safeName,
    stack: safeStack(input.stack),
    rank: progress.title,
    rankIndex: progress.level,
    note: noteFor(input),
  }
}

export function nameplates(seats: readonly NameplateInput[]): Nameplate[] {
  const plates: Nameplate[] = []
  for (const seat of seats) {
    const plate = nameplate(seat)
    if (plate !== null) plates.push(plate)
  }
  return plates
}

function noteFor(input: NameplateInput): Nameplate['note'] {
  if (input.disconnected) return 'reconnecting'
  if (input.sittingOut) return 'sitting out'
  if (input.folded) return 'folded'
  return null
}

function fallbackName(seat: number): string {
  return `Seat ${seat}`
}

function safeStack(stack: number): number {
  if (!Number.isFinite(stack)) return 0
  if (stack < 0) return 0
  return Math.floor(stack)
}
