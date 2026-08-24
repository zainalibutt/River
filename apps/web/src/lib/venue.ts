export type VenueId = 'rooftop' | 'basement' | 'suite'

export interface VenueCamera {
  radius: number
  height: number
  pitchDegrees: number
  fov: number
  /** Nothing over 2m may sit inside this, or the camera orbits through it. */
  clearRadius: number
}

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
