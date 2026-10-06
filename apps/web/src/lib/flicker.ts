/**
 * Fire that breathes.
 *
 * The terrace's flames - the braziers and the run in front of the pool - share one emissive
 * material, and the warm lights hung over them are rect lights in the rig. A fire whose
 * light never moves reads as a painted one, so both waver together: the flames by their
 * emission, and the lights by half as much, as a room lit by a fire does.
 *
 * Four incommensurate waves rather than random numbers: the same moment always gives the
 * same level, it never steps between frames, and it never settles into a visible period.
 */
export const FIRE_MATERIAL = 'rooftop_fire'

export const FIRE_LIGHT = /^fire_/

const WAVES: readonly (readonly [rate: number, phase: number, depth: number])[] = [
  [5.1, 0.7, 0.05],
  [11.3, 0, 0.08],
  [17.9, 1.3, 0.06],
  [29.1, 2.1, 0.04],
]

/** How bright the flames are at a moment, around 1 - never below 0.77 or above 1.23. */
export function fireLevel(seconds: number): number {
  let level = 1
  for (const [rate, phase, depth] of WAVES) level += depth * Math.sin(rate * seconds + phase)
  return level
}

/** The light a fire throws moves half as much as the fire itself. */
export function fireLightLevel(seconds: number): number {
  return 1 + (fireLevel(seconds) - 1) * 0.5
}
