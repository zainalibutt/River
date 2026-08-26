import type { VenueId } from './venue.js'

export interface RigLight {
  name: string
  type: string
  colour: string
  energy: number
  size: number
  shadow: boolean
  position: [number, number, number]
  rotation_deg: [number, number, number]
}

export interface RigWorldStop {
  position: number
  colour: string
}

export interface RigWorld {
  colour: string
  strength: number
  gradient?: RigWorldStop[]
}

export interface VenueRig {
  world: RigWorld
  camera: { radius: number; height: number; pitch: number; fov: number; clear_radius: number }
  lights: RigLight[]
}

export type LightingSidecar = Partial<Record<VenueId, VenueRig>>

export interface SceneLight {
  name: string
  /** RectAreaLight for the soft sources; the single caster becomes a spot. */
  kind: 'area' | 'spot'
  colour: string
  intensity: number
  width: number
  height: number
  position: [number, number, number]
  /** A point to aim at. A rect area light points nowhere useful until told. */
  target: [number, number, number]
  castShadow: boolean
}

/**
 * Which way a Blender lamp faces, in three.js space.
 *
 * Blender lamps emit along their local -Z, so an unrotated one points straight
 * down. A three.js RectAreaLight points along its own -Z, which is sideways,
 * and nothing in the rig said otherwise - so the 14-metre sky fill was firing
 * horizontally into the back wall instead of down onto the terrace. That reads
 * as a blown-out room rather than as a light facing the wrong way.
 */
export function lightDirection(rotationDegrees: readonly number[]): [number, number, number] {
  const [a, b, c] = [0, 1, 2].map((index) => ((rotationDegrees[index] ?? 0) * Math.PI) / 180)
  const [sinA, cosA] = [Math.sin(a ?? 0), Math.cos(a ?? 0)]
  const [sinB, cosB] = [Math.sin(b ?? 0), Math.cos(b ?? 0)]
  const [sinC, cosC] = [Math.sin(c ?? 0), Math.cos(c ?? 0)]
  // Blender applies Euler XYZ as Rz * Ry * Rx to the local -Z axis.
  const x = -cosA * sinB * cosC - sinA * sinC
  const y = -cosA * sinB * sinC + sinA * cosC
  const z = -cosA * cosB
  return blenderToThree([x, y, z])
}

/**
 * Blender is Z-up; three.js and glTF are Y-up. The venue meshes were exported
 * with export_yup, so the assets are already converted and the light positions
 * in the sidecar are not - they are still raw Blender coordinates.
 *
 * (x, y, z)_blender becomes (x, z, -y)_three. Getting this wrong puts the key
 * light under the floor, which reads as "the venue is too dark" rather than as
 * a coordinate bug.
 */
export function blenderToThree(position: readonly number[]): [number, number, number] {
  const x = position[0] ?? 0
  const y = position[1] ?? 0
  const z = position[2] ?? 0
  return [x, z, -y]
}

/**
 * Blender area-light energy is in watts; three.js intensity is unitless. There
 * is no exact conversion, so this is a single calibration scalar applied to
 * every light rather than per-light hand-tuning.
 *
 * One scalar is deliberate: hand-tuning each light is how the lookdev and the
 * web renderer drifted apart in the first place. If the venues read too dark or
 * too hot, change this number, not the individual energies.
 *
 * It came down from 0.06 to 0.008 once the lamps were aimed. The old value was
 * calibrated against a rig throwing most of its light at the back wall, so the
 * moment the sources pointed at the terrace a pale concrete floor went white.
 */
export const ENERGY_TO_INTENSITY = 0.008

export function intensityFor(energy: number): number {
  return Math.max(0, energy) * ENERGY_TO_INTENSITY
}

/**
 * three.js RectAreaLight does not cast shadows. The art direction budgets one
 * soft realtime caster per venue, so the light flagged `shadow` is converted to
 * a spot in the same place while the area lights carry the look.
 */
export function toSceneLights(rig: VenueRig | undefined): SceneLight[] {
  if (rig === undefined) return []
  return rig.lights.map((light) => {
    const position = blenderToThree(light.position)
    const direction = lightDirection(light.rotation_deg)
    return {
      name: light.name,
      kind: light.shadow ? 'spot' : 'area',
      colour: light.colour,
      intensity: intensityFor(light.energy),
      width: light.size,
      height: light.size,
      position,
      target: [position[0] + direction[0], position[1] + direction[1], position[2] + direction[2]],
      castShadow: light.shadow,
    }
  })
}

/** Exactly one caster per venue is the whole shadow budget. */
export function shadowCasterCount(lights: readonly SceneLight[]): number {
  return lights.filter((light) => light.castShadow).length
}

export function worldColourOf(rig: VenueRig | undefined, fallback = '#101613'): string {
  return rig?.world.colour ?? fallback
}

export async function loadLightingSidecar(
  fetchImpl: typeof fetch = fetch,
): Promise<LightingSidecar> {
  try {
    const response = await fetchImpl('/assets/lighting.json')
    if (!response.ok) return {}
    return (await response.json()) as LightingSidecar
  } catch {
    // A venue that cannot fetch its rig should still be playable, just flat.
    return {}
  }
}
