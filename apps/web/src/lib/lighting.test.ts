import { describe, expect, it } from 'vitest'
import {
  blenderToThree,
  FILL_ATTENUATION,
  intensityFor,
  lightDirection,
  loadLightingSidecar,
  shadowCasterCount,
  toSceneLights,
  type VenueRig,
} from './lighting.js'

const rig: VenueRig = {
  world: { colour: '#101613', strength: 1.5 },
  camera: { radius: 6.1, height: 4.05, pitch: 62, fov: 64, clear_radius: 8.4 },
  lights: [
    {
      name: 'table',
      type: 'area',
      colour: '#FFE2BC',
      energy: 240,
      size: 5.5,
      shadow: true,
      position: [0, 0, 3.9],
      rotation_deg: [0, 0, 0],
    },
    {
      name: 'fire_key',
      type: 'area',
      colour: '#FF7A22',
      energy: 320,
      size: 6,
      shadow: false,
      position: [-4.2, 3, 1.6],
      rotation_deg: [64, 0, -58],
    },
  ],
}

describe('venue lighting', () => {
  it('converts Blender Z-up to three.js Y-up', () => {
    expect(blenderToThree([1, 2, 3])).toEqual([1, 3, -2])
  })

  it('keeps a light above the floor above the floor', () => {
    // The table key sits at z=3.9 in Blender, which must become y=3.9, not y=0.
    const [, y] = blenderToThree([0, 0, 3.9])
    expect(y).toBeCloseTo(3.9)
  })

  it('maps a light in front of the table to negative z, not positive', () => {
    const [, , z] = blenderToThree([0, 6, 0])
    expect(z).toBe(-6)
  })

  it('scales energy by one shared calibration constant', () => {
    expect(intensityFor(240)).toBeCloseTo(intensityFor(120) * 2)
    expect(intensityFor(0)).toBe(0)
  })

  it('never produces negative intensity', () => {
    expect(intensityFor(-50)).toBe(0)
  })

  it('turns the flagged light into a spot, because RectAreaLight cannot cast', () => {
    const lights = toSceneLights(rig)
    expect(lights.find((light) => light.name === 'table')?.kind).toBe('spot')
    expect(lights.find((light) => light.name === 'fire_key')?.kind).toBe('area')
  })

  it('holds the one-caster budget', () => {
    expect(shadowCasterCount(toSceneLights(rig))).toBe(1)
  })

  it('carries the area size through as light dimensions', () => {
    const fire = toSceneLights(rig).find((light) => light.name === 'fire_key')
    expect(fire?.width).toBe(6)
    expect(fire?.height).toBe(6)
  })

  it('returns no lights for a venue with no rig rather than throwing', () => {
    expect(toSceneLights(undefined)).toEqual([])
  })

  it('degrades to an unlit venue when the sidecar cannot be fetched', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    await expect(loadLightingSidecar(failing)).resolves.toEqual({})
  })

  it('degrades when the sidecar responds with an error status', async () => {
    const notFound = (() =>
      Promise.resolve({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    await expect(loadLightingSidecar(notFound)).resolves.toEqual({})
  })
})

describe('lamp aiming', () => {
  it('points an unrotated lamp straight down', () => {
    // Blender lamps emit along local -Z, which for zero rotation is down. Every
    // light in all three rigs is unrotated, so this single case is the whole
    // difference between a lit terrace and a blown-out back wall.
    const [x, y, z] = lightDirection([0, 0, 0])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(-1, 9)
    expect(z).toBeCloseTo(0, 9)
  })

  it('never leaves a lamp pointing along the three.js -Z default', () => {
    // That default is the bug: sideways at the nearest wall.
    const [, , z] = lightDirection([0, 0, 0])
    expect(z).not.toBeCloseTo(-1, 3)
  })

  it('tips a lamp toward the horizon when pitched ninety degrees', () => {
    const [x, y, z] = lightDirection([90, 0, 0])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(0, 9)
    expect(z).toBeCloseTo(-1, 9)
  })

  it('keeps the direction a unit vector at arbitrary rotations', () => {
    for (const rotation of [
      [0, 0, 0],
      [35, 0, 0],
      [0, 47, 0],
      [0, 0, 61],
      [23, -54, 129],
      [-90, 90, -90],
    ]) {
      const [x, y, z] = lightDirection(rotation)
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9)
    }
  })

  it('treats a missing rotation as unrotated', () => {
    expect(lightDirection([])).toEqual(lightDirection([0, 0, 0]))
  })

  it('aims every light in a rig at a point one metre along its beam', () => {
    const rig = {
      world: { colour: '#101613', strength: 1.5 },
      camera: { radius: 6.1, height: 4.05, pitch: 62, fov: 64, clear_radius: 8.4 },
      lights: [
        {
          name: 'sky_fill',
          type: 'area',
          colour: '#5C74B8',
          energy: 300,
          size: 14,
          shadow: false,
          position: [0, 1, 7] as [number, number, number],
          rotation_deg: [0, 0, 0] as [number, number, number],
        },
      ],
    }
    const [light] = toSceneLights(rig)
    if (light === undefined) throw new Error('expected a light')
    expect(light.position).toEqual([0, 7, -1])
    // One metre below it, because the lamp faces down.
    expect(light.target[0]).toBeCloseTo(0, 9)
    expect(light.target[1]).toBeCloseTo(6, 9)
    expect(light.target[2]).toBeCloseTo(-1, 9)
  })
})

describe('fill attenuation', () => {
  const rig = {
    world: { colour: '#101613', strength: 1.5 },
    camera: { radius: 6.1, height: 4.05, pitch: 62, fov: 64, clear_radius: 8.4 },
    lights: [
      {
        name: 'table',
        type: 'area',
        colour: '#FFE2BC',
        energy: 240,
        size: 5.5,
        shadow: true,
        position: [0, 0, 3.9] as [number, number, number],
        rotation_deg: [0, 0, 0] as [number, number, number],
      },
      {
        name: 'sky_fill',
        type: 'area',
        colour: '#5C74B8',
        energy: 240,
        size: 14,
        shadow: false,
        position: [0, 1, 7] as [number, number, number],
        rotation_deg: [0, 0, 0] as [number, number, number],
      },
    ],
  }

  it('leaves the one shadow caster at full strength', () => {
    const [key] = toSceneLights(rig)
    expect(key?.intensity).toBeCloseTo(intensityFor(240), 9)
  })

  it('discounts a fill, because it cannot be occluded by anything', () => {
    // Same energy, same size class: the only difference is that one of them
    // casts a shadow and the other floods.
    const [, fill] = toSceneLights(rig)
    expect(fill?.intensity).toBeCloseTo(intensityFor(240) * FILL_ATTENUATION, 9)
  })

  it('keeps the key brighter than an equal-energy fill, so the table leads', () => {
    const [key, fill] = toSceneLights(rig)
    expect(key?.intensity ?? 0).toBeGreaterThan(fill?.intensity ?? 0)
  })
})
