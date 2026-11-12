/**
 * The first hand a browser plays is coached; every hand after it is not.
 *
 * Kept per browser, not per account: a guest has no account, and a player who
 * has sat through one hand here has seen the help whoever they are signed in as.
 */
export const FIRST_HAND_KEY = 'river:first-hand-played'

export function firstHandPlayed(): boolean {
  try {
    return window.localStorage.getItem(FIRST_HAND_KEY) !== null
  } catch {
    // Storage unavailable: coach every time rather than never.
    return false
  }
}

export function markFirstHandPlayed(nowMs = Date.now()): void {
  try {
    if (window.localStorage.getItem(FIRST_HAND_KEY) === null) {
      window.localStorage.setItem(FIRST_HAND_KEY, String(nowMs))
    }
  } catch {
    // Without storage the coaching simply shows again next visit.
  }
}

/** One line on a first turn: what each button does here, in this spot. */
export function coachLine(checking: boolean, callLabel: string, canRaise: boolean): string {
  const raise = canRaise ? (checking ? ' Bet to put chips in.' : ' Raise to bet more.') : ''
  return checking
    ? `Nobody has bet: check to see the next card for free.${raise} The gold ring is your clock.`
    : `Someone bet. ${callLabel} to stay in, or fold to drop out.${raise} The gold ring is your clock.`
}
