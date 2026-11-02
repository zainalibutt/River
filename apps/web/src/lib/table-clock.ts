/**
 * The table's clock.
 *
 * Everything that moves on the table reads the time here rather than from
 * performance.now() directly: the felt's cards and chips, the showdown's schedule and the
 * sounds they play. In play the two are the same. The motion lab can run it slower, stop
 * it and run it faster, so a deal, a run-out or a showdown can be reviewed a frame at a
 * time; a CSS animation follows through its playback rate, which the lab sets to match.
 */

let rate = 1
/** The real time and the table time at the last change of rate, which the clock runs from. */
let realAt = 0
let tableAt = 0

function realNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now()
}

/** The table's time, in milliseconds on the performance clock's scale. */
export function tableNow(): number {
  return tableAt + (realNow() - realAt) * rate
}

/** How fast the table's clock runs against real time: 1 in play, 0 when stopped. */
export function tableRate(): number {
  return rate
}

/** Runs the table's clock at `next` times real time, from where it stands now. */
export function setTableRate(next: number): void {
  tableAt = tableNow()
  realAt = realNow()
  rate = Math.max(0, next)
}

/** Back to real time, as play runs; the lab calls this when it closes. */
export function resetTableClock(): void {
  rate = 1
  realAt = 0
  tableAt = 0
}
