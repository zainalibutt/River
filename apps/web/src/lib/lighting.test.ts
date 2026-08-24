import { describe, expect, it } from 'vitest'
import {
  blenderToThree,
  intensityFor,
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
