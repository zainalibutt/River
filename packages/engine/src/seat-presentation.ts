export type SeatMood =
  | 'empty'
  | 'waiting'
  | 'dealt'
  | 'acting'
  | 'folded'
  | 'allIn'
  | 'won'
  | 'busted'
  | 'away'
  | 'sittingOut'

export interface SeatFacts {
  occupied: boolean
  stack: number
  hasHole: boolean
  folded: boolean
  allIn: boolean
  busted: boolean
  sittingOut: boolean
  disconnected: boolean
  isActor: boolean
  wonLastHand: boolean
  handLive: boolean
}

const PRIORITY: readonly SeatMood[] = [
  'busted',
  'allIn',
  'acting',
  'folded',
  'won',
  'away',
  'sittingOut',
  'dealt',
  'waiting',
  'empty',
]

export function seatMood(facts: SeatFacts): SeatMood {
  if (!facts.occupied) return 'empty'
  if (facts.busted) return 'busted'
  if (facts.allIn) return 'allIn'
  if (facts.isActor) return 'acting'
  if (facts.folded) return 'folded'
  if (facts.wonLastHand) return 'won'
  if (facts.disconnected) return 'away'
  if (facts.sittingOut) return 'sittingOut'
  if (facts.hasHole && facts.handLive) return 'dealt'
  return 'waiting'
}

export function moodPriority(): readonly SeatMood[] {
  return PRIORITY
}

export function seatIsInteractive(facts: SeatFacts): boolean {
  return !facts.occupied
}
