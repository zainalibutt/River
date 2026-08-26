export type VenueId = 'rooftop' | 'basement' | 'suite'

export interface VenueCamera {
  radius: number
  height: number
  pitchDegrees: number
  fov: number
  /** Nothing over 2m may sit inside this, or the camera orbits through it. */
  clearRadius: number
}

export interface CameraPlacement {
  /** three.js world space, ready to hand to a camera. */
  position: [number, number, number]
  target: [number, number, number]
  /** Distance from position to target. The orbit runs on a fixed radius. */
  distance: number
}

/**
 * The height the camera looks at: the felt, not the floor.
 *
 * Aiming at the origin points the camera at the underside of the table and
 * tips the whole venue up out of frame.
 */
export const TABLE_SURFACE_HEIGHT = 0.55

export interface Venue {
  id: VenueId
  name: string
  tagline: string
  asset: string
  camera: VenueCamera
  /** Seat ring radius. The Suite's chairs are deeper, so its ring is tighter. */
  seatRadius: number
  /** Meshes that cast the single soft shadow this venue budgets for. */
  shadowCasters: RegExp
}

/**
 * Measured from the lookdev builds and recorded in
 * docs/design/14-venue-build-spec.md. The interaction model is shared across
 * venues; these numbers are not.
 */
export const VENUES: Readonly<Record<VenueId, Venue>> = {
  rooftop: {
    id: 'rooftop',
    name: 'The Rooftop',
    tagline: 'City lights, open air, and a skyline that watches you lose.',
    asset: '/assets/rooftop_assets.glb',
    camera: { radius: 6.1, height: 4.05, pitchDegrees: 62, fov: 64, clearRadius: 8.4 },
    seatRadius: 3.05,
    shadowCasters: /^(river_rooftop_wood|river_rooftop_felt|river_rooftop_rail)$/,
  },
  basement: {
    id: 'basement',
    name: 'The Laundromat',
    tagline: 'Strip lights, spin cycles, and nobody asking questions.',
    asset: '/assets/basement_assets.glb',
    camera: { radius: 3.6, height: 2.45, pitchDegrees: 72, fov: 66, clearRadius: 6.0 },
    seatRadius: 2.6,
    shadowCasters: /^(river_basement_wood|river_basement_felt|river_basement_rail)$/,
  },
  suite: {
    id: 'suite',
    name: 'The Executive Suite',
    tagline: 'Chandeliers, a full bar, and an audience beyond the rail.',
    asset: '/assets/suite_assets.glb',
    camera: { radius: 3.9, height: 2.85, pitchDegrees: 68, fov: 66, clearRadius: 5.4 },
    seatRadius: 2.35,
    shadowCasters: /^(river_suite_wood|river_suite_felt|river_suite_rail)$/,
  },
}

/**
 * Where the camera actually goes, converted once from the measured values.
 *
 * The pipeline places the play camera at Blender (0, -radius, height). The
 * scene used to hardcode that as three.js [0, height, -radius], which flips the
 * sign the conversion puts on Z and seats the camera on the far side of the
 * table from the one the venue was lit and framed for. Every light already went
 * through blenderToThree; the camera did not, so the two disagreed about which
 * way round the room was.
 */
export function cameraPlacement(venue: Venue): CameraPlacement {
  // This is blenderToThree([0, -radius, height]) written out. The conversion is
  // not imported, because lighting.ts refers back to this module and the scene
  // loads through a dynamic chunk that will not tolerate the cycle. A test
  // asserts the two agree, so the duplication cannot drift unnoticed.
  const position: [number, number, number] = [0, venue.camera.height, venue.camera.radius]
  const target: [number, number, number] = [0, TABLE_SURFACE_HEIGHT, 0]
  return {
    position,
    target,
    distance: Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]),
  }
}

/**
 * The measured field of view, as three.js wants it.
 *
 * Blender fits a landscape camera's angle horizontally; three.js reads fov
 * vertically. Handing 64 straight to the camera therefore asks for a far wider
 * view than the one that was measured, and the table sits small and distant in
 * a frame that looks nothing like the render it was signed off from.
 */
export function verticalFov(horizontalDegrees: number, aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return horizontalDegrees
  const horizontal = (horizontalDegrees * Math.PI) / 180
  const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / aspect)
  return (vertical * 180) / Math.PI
}

export const VENUE_ORDER: readonly VenueId[] = ['rooftop', 'basement', 'suite']

export const DEFAULT_VENUE: VenueId = 'rooftop'

export function isVenueId(value: string | null | undefined): value is VenueId {
  return value === 'rooftop' || value === 'basement' || value === 'suite'
}

/**
 * Everyone at a table must see the same room, so the venue travels in the
 * invite URL alongside the room id and code rather than being a local
 * preference. An unknown or missing venue falls back rather than failing - a
 * stale link should still seat you.
 */
export function venueFromParams(params: URLSearchParams): VenueId {
  const value = params.get('venue')?.trim().toLowerCase()
  return isVenueId(value) ? value : DEFAULT_VENUE
}

export function venueOf(id: VenueId): Venue {
  return VENUES[id]
}

/** Kept for the existing scene import; the Rooftop remains the default room. */
export const rooftopCamera = VENUES.rooftop.camera

export type WorldSeat = {
  id: string
  x: number
  y: number
  z: number
}

export function worldSeats(
  ids: readonly string[],
  radius = VENUES.rooftop.seatRadius,
): WorldSeat[] {
  return ids.map((id, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ids.length
    return { id, x: Math.cos(angle) * radius, y: 0.54, z: Math.sin(angle) * radius }
  })
}
