export interface SizingState {
  pot: number
  currentBet: number
  toCall: number
  minRaiseTo: number
  allInTo: number
}

export interface SizingPreset {
  id: string
  label: string
  amount: number
}

/**
 * A raise-to total for a bet of `fraction` times the pot.
 *
 * The pot a raise is sized against is the pot *after* the raiser calls, so the
 * call is counted twice: once to match the bet and once inside the pot the
 * raise is measured from. Dropping it is the classic error and it under-bets
 * every raise made into a live bet.
 *
 *   raiseTo = currentBet + fraction x (pot + toCall)
 *
 * which expands from `myBetStreet + toCall + fraction x (pot + toCall)` given
 * `myBetStreet = currentBet - toCall`. Preflop at 250/500 the button faces a
 * pot of 750 and a call of 500, so a pot-sized raise is 1,750: call 500 into a
 * pot of 1,250, then raise 1,250 more.
 *
 * Results are exact rather than rounded to the big blind. A pot-sized raise is
 * rarely a multiple of the blind, and 1,750 rounded to 2,000 is a fourteen per
 * cent error under a label that says POT. The dial's fine step moves by one big
 * blind from wherever the value already is, so an exact preset stays reachable.
 */
export function raiseToForPotFraction(state: SizingState, fraction: number): number {
  const raw = state.currentBet + fraction * (state.pot + state.toCall)
  return clampToLegal(state, Math.round(raw))
}

/**
 * MIN, half, three-quarter and full pot. There is no MAX: it returned the same
 * figure as the ALL IN wedge sitting one press away, so a quarter of the rail
 * bought nothing, while three-quarter pot — the standard value bet — could not
 * be reached at all.
 */
export function sizingPresets(state: SizingState): SizingPreset[] {
  return [
    { id: 'minimum', label: 'MIN', amount: clampToLegal(state, state.minRaiseTo) },
    { id: 'half-pot', label: '½', amount: raiseToForPotFraction(state, 0.5) },
    { id: 'three-quarter-pot', label: '¾', amount: raiseToForPotFraction(state, 0.75) },
    { id: 'pot', label: 'POT', amount: raiseToForPotFraction(state, 1) },
  ]
}

function clampToLegal(state: SizingState, amount: number): number {
  return Math.min(state.allInTo, Math.max(state.minRaiseTo, amount))
}
