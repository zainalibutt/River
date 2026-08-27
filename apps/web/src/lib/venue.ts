/** The felt's half-axes, straight from art/pipeline/values.py. */
const FELT_RX = 1.24
const FELT_RY = 0.72

/**
 * How far the pool of light on the table should reach.
 *
 * The felt's long half-axis plus the rail. The caster's cone is derived from
 * this rather than carrying its own angle, because a hardcoded angle knows
 * nothing about the table it is pointed at - the one it replaced threw a cone
 * 2.24m across a felt 1.24m wide and spilled 81 percent of itself onto the
 * floor, which measured as the floor taking three times more of that light than
 * the table did.
 */
export const FELT_LIGHT_REACH = FELT_RX + 0.2

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
 *
 * 0.76 is measured, not chosen. Read out of the shipped GLB: the felt plane
 * sits at y 0.76, the rail runs 0.76 to 0.82, and a chair spans 0.38 to 0.88 -
 * so the table clears its seats by about 0.30m, which is what a real one does.
 *
 * This was 0.55 for months and nothing in the asset was ever at 0.55. The
 * camera has been aiming 21cm under the felt, and because it is also the pivot
 * the orbit controls turn around, the whole room rotated about a point in the
 * air beneath the table.
 */
export const TABLE_SURFACE_HEIGHT = 0.76

/**
 * How far the orbit may tilt, measured from straight up.
 *
 * 85 degrees is nearly level with the felt; 55 is a raised view. The reference
 * never goes bird's eye, and going there is what turns the seats back into open
 * cylinders.
 *
 * The floor was 55, which let the orbit reach a bird's eye looking down into the
 * open tops of the seats - the exact framing that made nine dressed characters
 * read as people standing in tubs, and the first thing anybody dragging the
 * camera found.
 *
 * 61 is the tightest floor that clears every venue's own opening shot. Measured
 * rather than chosen: the Rooftop opens at 76.98 degrees from vertical, the
 * Laundromat at 64.85 and the Suite at 61.81. 62 was tried first and the gate
 * refused it, because the Suite would have been silently clamped on its first
 * frame - which is precisely the failure the gate was written for.
 *
 * Exported because the controls and the test that guards them were carrying
 * the same two numbers as separate literals. A default outside this range is
 * silently clamped on the first frame, so the framing is lost before anyone
 * sees it - which is worth a gate, and worth the gate reading the same source
 * the controls do.
 */
export const ORBIT_POLAR_DEGREES = { min: 61, max: 85 } as const

export interface Venue {
  id: VenueId
  name: string
  tagline: string
  asset: string
  camera: VenueCamera
  /**
   * The seat ring, as an ellipse. The table is oval, so a circle puts the two
   * side seats a metre off the chairs they are meant to label. Mirrors
   * character_seat_positions in the pipeline: the Suite's chairs are deeper, so
   * its ring is tighter.
   */
  seatRing: { x: number; y: number }
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
    // Set against the reference rather than against the lookdev render - see
    // docs/design/22-shot-composition.md, which measures all three numbers off
    // a frame of the game this one is cloning.
    //
    // It was 6.1m out and 4.05m up, looking down 29.9 degrees. Three
    // consequences, all of them visible: the terrace is only 4.0m across, so
    // the camera stood outside the parapet looking in; half the frame was
    // floor; and from that height you look down into the open tops of the seat
    // cylinders, which is why nine dressed characters read as people standing
    // in tubs.
    //
    // The tell to check any future change against is the felt's foreshortening.
    // The reference reads the table as a flattened band about 18 percent of
    // frame height. A round ellipse means the camera has crept back up.
    camera: { radius: 3.2, height: 1.5, pitchDegrees: 73.5, fov: 64, clearRadius: 8.4 },
    seatRing: { x: FELT_RX * 1.42, y: FELT_RY * 1.58 },
    shadowCasters: /^(river_rooftop_wood|river_rooftop_felt|river_rooftop_rail)$/,
  },
  basement: {
    id: 'basement',
    name: 'The Laundromat',
    tagline: 'Strip lights, spin cycles, and nobody asking questions.',
    asset: '/assets/basement_assets.glb',
    camera: { radius: 3.6, height: 2.45, pitchDegrees: 72, fov: 66, clearRadius: 6.0 },
    seatRing: { x: FELT_RX * 1.42, y: FELT_RY * 1.58 },
    shadowCasters: /^(river_basement_wood|river_basement_felt|river_basement_rail)$/,
  },
  suite: {
    id: 'suite',
    name: 'The Executive Suite',
    tagline: 'Chandeliers, a full bar, and an audience beyond the rail.',
    asset: '/assets/suite_assets.glb',
    camera: { radius: 3.9, height: 2.85, pitchDegrees: 68, fov: 66, clearRadius: 5.4 },
    seatRing: { x: FELT_RX * 1.3, y: FELT_RY * 1.44 },
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

/**
 * How many places the venue lays around the felt.
 *
 * Nine, of which the dealer occupies the first. This is a property of the built
 * asset - the chairs are baked on this ring - so it does not follow the number
 * of players and must match character_seat_positions in the pipeline.
 */
export const SEAT_SLOTS = 9

export type WorldSeat = {
  id: string
  x: number
  y: number
  z: number
}

export function worldSeats(
  ids: readonly string[],
  ring: { x: number; y: number } = VENUES.rooftop.seatRing,
): WorldSeat[] {
  return ids.map((id, index) => {
    // seat_positions in the pipeline, converted. Blender lays the ring out as
    // (Rx cos a, Ry sin a) from a quarter turn, and (x, y, z) becomes
    // (x, z, -y) - so the z sign flips and the ring is not a circle. Getting
    // either wrong leaves every chip count hovering beside the wrong chair.
    // Slots 1 to 8 of a nine-slot ring. Slot 0 is the dealer's, and the ring
    // must divide by nine however many players are sitting or the chips land
    // between the chairs the venue actually baked.
    const angle = Math.PI / 2 + ((index + 1) * Math.PI * 2) / SEAT_SLOTS
    return {
      id,
      x: ring.x * Math.cos(angle),
      // Head height, not seat height. Anchoring at the felt buries the plaque
      // in the player it labels; above the head it reads as theirs.
      y: 1.46,
      z: -ring.y * Math.sin(angle),
    }
  })
}
