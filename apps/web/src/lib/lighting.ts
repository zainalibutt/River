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
 * It went 0.06 -> 0.008 -> 0.0667, and the round trip is the story.
 *
 * The cut to 0.008 was made because "a pale concrete floor went white". That
 * floor was authored as 121A1D, which is near-black rock, and it shipped
 * reading #4b5a5f. Every material in every venue went through a conversion
 * that fed an sRGB number into a linear input, lifting dark albedos by up to
 * thirteen times and light ones barely at all - so the room was not overlit,
 * it was painted in surfaces eight times more reflective than anyone chose,
 * all crushed toward the same middle grey. Turning the lights down hid the
 * symptom and made the flatness permanent, because the contrast that was lost
 * was lost in the albedos, where no lighting change can reach it.
 *
 * With the albedos corrected the venues lose 8.34x of their reflected light,
 * measured area-weighted across all three by art/relinearise-venues.mjs. 0.008
 * times 8.34 is 0.0667, which is within ten percent of the value this started
 * at - the first calibration was right, and had been detuned to compensate for
 * a bug two layers below it.
 */
export const ENERGY_TO_INTENSITY = 0.0667

/**
 * How much a shadowless fill is worth.
 *
 * three.js rect area lights cast no shadows. In Blender the same sources are
 * occluded by the parapet, the chairs and the players, so a fourteen metre sky
 * fill lights the terrace in patches. Here it lights everything evenly, and a
 * venue with no occlusion anywhere has no dark in it - the floor comes out
 * brighter than the felt and the eye has nowhere to go.
 *
 * Rather than hand-tuning each lamp, every fill is worth a fraction of its
 * measured energy and the one shadow-casting key is left alone. That keeps a
 * single number to change, and it keeps the pool of light on the table where
 * the room was designed to put it.
 */
export const FILL_ATTENUATION = 0.55

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
      intensity: intensityFor(light.energy) * (light.shadow ? 1 : FILL_ATTENUATION),
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

/**
 * What the world is worth as light.
 *
 * Blender's world colour lights the scene. three.js `scene.background` does
 * not - it is a backdrop and contributes nothing - so an ambient light has to
 * stand in for it, and the two have to agree or the browser and the lookdev are
 * rendering different rooms.
 *
 * They did not agree. The ambient was a flat white 0.11 while the Rooftop's
 * world is 101613 at strength 1.5, which is a green-black worth about 0.009 of
 * linear radiance. Twelve times too strong, and neutral where it should be
 * tinted - and ambient is the one light nothing can occlude, so every part of
 * that excess was contrast removed from every surface in the venue at once.
 *
 * Derived rather than dialled: three.js multiplies the ambient colour by its
 * intensity, and Blender multiplies the world colour by its strength, so
 * handing over both makes the two expressions the same expression.
 */
export function ambientFor(rig: VenueRig | undefined): { colour: string; intensity: number } {
  return {
    colour: worldColourOf(rig),
    intensity: rig?.world.strength ?? DEFAULT_WORLD_STRENGTH,
  }
}

/** The Rooftop's measured world strength, used when the sidecar is missing. */
const DEFAULT_WORLD_STRENGTH = 1.5

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
