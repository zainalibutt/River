/**
 * The aircraft warning lights on the Rooftop's skyline.
 *
 * The pipeline builds every mast-top light as one mesh on one material of its own - see
 * art/pipeline/skyline.py - so that the browser can flash them without touching the city
 * they sit on. They flash together, about thirty times a minute, which is what obstruction
 * lights on a skyline do.
 *
 * Eased on and off rather than switched. A light a few pixels across that jumps between
 * full and nothing reads as a rendering fault at this distance, not as a lamp.
 */
export const BEACON_MESH = /_skyline_beacons$/

export const BEACON_PERIOD_SECONDS = 2

/** The part of each period a light is on for, and how long its edges take. */
const ON_FRACTION = 0.34
const EDGE_FRACTION = 0.08

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** How lit the beacons are at a moment, from 0 (dark) to 1 (the material's own strength). */
export function beaconLevel(seconds: number): number {
  const period = BEACON_PERIOD_SECONDS
  const phase = (((seconds % period) + period) % period) / period
  const rise = smoothstep(0, EDGE_FRACTION, phase)
  const fall = 1 - smoothstep(ON_FRACTION - EDGE_FRACTION, ON_FRACTION + EDGE_FRACTION, phase)
  return rise * fall
}
