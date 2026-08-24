export type RevealDecision = 'show' | 'muck' | 'forced'

export interface ShowdownSeat {
  seat: number
  folded: boolean
  allIn: boolean
  handRank: number | null
  lastAggressorOnRiver: boolean
}

export interface RevealStep {
  seat: number
  order: number
  decision: RevealDecision
  beatsShownSoFar: boolean
}

export function revealOrder(seats: readonly ShowdownSeat[]): readonly RevealStep[] {
  const live = seats.filter((seat) => !seat.folded)
  if (live.length === 0) return []

  let first: ShowdownSeat | null = null
  for (const seat of live) {
    if (seat.lastAggressorOnRiver) {
      first = seat
      break
    }
  }
  if (first === null) {
    for (const seat of live) {
      if (first === null || seat.seat < first.seat) first = seat
    }
  }
  if (first === null) {
    throw new Error('unreachable: live seats always select a first revealer')
  }

  const steps: RevealStep[] = [
    {
      seat: first.seat,
      order: 0,
      decision: 'forced',
      beatsShownSoFar: true,
    },
  ]
  let shownMax: number | null = first.handRank

  const rest = live.filter((seat) => seat !== first).sort((a, b) => a.seat - b.seat)

  let order = 1
  for (const seat of rest) {
    const rank = seat.handRank
    const beatsShown = rank !== null && shownMax !== null && rank > shownMax
    let decision: RevealDecision
    if (seat.allIn) {
      decision = 'forced'
    } else if (rank !== null && shownMax !== null && rank > shownMax) {
      decision = 'forced'
    } else if (rank !== null && shownMax !== null && rank === shownMax) {
      decision = 'show'
    } else {
      decision = 'muck'
    }
    steps.push({
      seat: seat.seat,
      order,
      decision,
      beatsShownSoFar: beatsShown,
    })
    if (decision === 'forced' || decision === 'show') {
      if (rank !== null && (shownMax === null || rank > shownMax)) {
        shownMax = rank
      }
    }
    order += 1
  }

  return steps
}

export function mustShow(step: RevealStep): boolean {
  return step.decision === 'forced'
}
