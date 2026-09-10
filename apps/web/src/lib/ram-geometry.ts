/**
 * Geometry for the radial action menu.
 *
 * `04-anatomy.md` gives the menu an outer diameter of 420 base-canvas pixels
 * with the betting dial occupying its interior, so the wedges are segments of
 * an annulus rather than buttons arranged in a circle. That distinction is
 * forced rather than stylistic: a 420 ring cannot hold both a centred dial
 * worth reading and rectangular wedges wide enough for `RAISE TO 8,000`, and
 * the annulus is the shape that resolves it.
 *
 * Wedge slots are fixed to compass points rather than divided evenly among the
 * legal actions, so fold is in the same place whether or not raising is legal.
 * Muscle memory is the whole point of a spatial action surface.
 */

export const RAM_DIAMETER = 420
export const RAM_OUTER_RADIUS = RAM_DIAMETER / 2
export const RAM_INNER_RADIUS = 96
export const DIAL_DIAMETER = RAM_INNER_RADIUS * 2 - 12

const ARC_STEPS = 12
const WEDGE_GAP_DEGREES = 3

export type WedgeSlot = 'fold' | 'call' | 'raise' | 'all-in'

/** Screen angles, clockwise from twelve o'clock, at the centre of each slot. */
export const WEDGE_BEARING: Record<WedgeSlot, number> = {
  fold: 0,
  raise: 90,
  'all-in': 180,
  call: 270,
}

function pointAt(bearingDegrees: number, radius: number): [number, number] {
  const radians = ((bearingDegrees - 90) * Math.PI) / 180
  return [
    RAM_OUTER_RADIUS + radius * Math.cos(radians),
    RAM_OUTER_RADIUS + radius * Math.sin(radians),
  ]
}

function arc(from: number, to: number, radius: number): [number, number][] {
  return Array.from({ length: ARC_STEPS + 1 }, (_, step) =>
    pointAt(from + ((to - from) * step) / ARC_STEPS, radius),
  )
}

/**
 * A `clip-path` polygon for one wedge, in percentages of the 420 box.
 *
 * The clip is the hit area as well as the paint, which is why the arcs are
 * walked rather than approximated with a square corner: a player aiming at the
 * visible edge of a wedge must hit that wedge and nothing else.
 */
export function wedgeClipPath(slot: WedgeSlot, spanDegrees = 90): string {
  const bearing = WEDGE_BEARING[slot]
  const half = spanDegrees / 2 - WEDGE_GAP_DEGREES / 2
  const outer = arc(bearing - half, bearing + half, RAM_OUTER_RADIUS)
  const inner = arc(bearing + half, bearing - half, RAM_INNER_RADIUS)
  const percent = ([x, y]: [number, number]): string =>
    `${((x / RAM_DIAMETER) * 100).toFixed(3)}% ${((y / RAM_DIAMETER) * 100).toFixed(3)}%`
  return `polygon(${[...outer, ...inner].map(percent).join(', ')})`
}

/** Where a wedge's label sits: the middle of its annulus, on its bearing. */
export function wedgeLabelOffset(slot: WedgeSlot): { left: string; top: string } {
  const [x, y] = pointAt(WEDGE_BEARING[slot], (RAM_OUTER_RADIUS + RAM_INNER_RADIUS) / 2)
  return {
    left: `${((x / RAM_DIAMETER) * 100).toFixed(3)}%`,
    top: `${((y / RAM_DIAMETER) * 100).toFixed(3)}%`,
  }
}
