import { describe, expect, it } from 'vitest'
import type { Vec3, VenueCameraSpec } from './venue-camera.js'
import { blenderToThree, framesTable, orbitCamera, threeToBlender } from './venue-camera.js'

const ROOFTOP: VenueCameraSpec = { radius: 6.1, height: 4.05, pitchDegrees: 62, fov: 64 }

describe('coordinate round trip', () => {
  it('round-trips twelve points including negatives and zeros', () => {
    const points: readonly Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 6.1, y: -4.05, z: 3.5 },
      { x: -2.5, y: 7.25, z: -0.5 },
      { x: 100, y: -100, z: 100 },
      { x: -0.25, y: 0.5, z: -0.75 },
      { x: 12.345, y: -67.89, z: 0.001 },
    ]
    for (const point of points) {
      expect(threeToBlender(blenderToThree(point))).toEqual(point)
    }
  })

  it('keeps threeToBlender the exact inverse of blenderToThree', () => {
    for (const point of [
      { x: 1, y: 2, z: 3 },
      { x: -9, y: 0.5, z: -0.25 },
    ]) {
      expect(blenderToThree(threeToBlender(point))).toEqual(point)
    }
  })
})

describe('handedness under the repo conversion', () => {
  it('keeps a point on Blender +X on three.js +X', () => {
    const converted = blenderToThree({ x: 1, y: 0, z: 0 })
    expect(converted.x).toBe(1)
    expect(Math.abs(converted.y)).toBe(0)
    expect(Math.abs(converted.z)).toBe(0)
  })

  it('maps Blender -Y (forward) to three.js +Z under (x, z, -y)', () => {
    const converted = blenderToThree({ x: 0, y: -1, z: 0 })
    expect(Math.abs(converted.x)).toBe(0)
    expect(Math.abs(converted.y)).toBe(0)
    expect(converted.z).toBe(1)
  })

  it('maps Blender Z-up to three.js Y-up', () => {
    const converted = blenderToThree({ x: 0, y: 0, z: 1 })
    expect(Math.abs(converted.x)).toBe(0)
    expect(converted.y).toBe(1)
    expect(Math.abs(converted.z)).toBe(0)
  })

  it('converts the venue play camera to the side the pipeline looks from', () => {
    const playCam = blenderToThree({ x: 0, y: -ROOFTOP.radius, z: ROOFTOP.height })
    expect(playCam.x).toBe(0)
    expect(playCam.y).toBe(ROOFTOP.height)
    expect(playCam.z).toBe(ROOFTOP.radius)
  })
})

describe('orbitCamera', () => {
  it('puts the camera at the Blender play-camera position at azimuth 0 and targets the origin', () => {
    const atZero = orbitCamera(ROOFTOP, 0)
    expect(atZero.position.x).toBeCloseTo(0, 12)
    expect(atZero.position.y).toBe(ROOFTOP.height)
    expect(atZero.position.z).toBeCloseTo(ROOFTOP.radius, 12)
    expect(atZero.target).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('keeps the camera exactly radius from the vertical axis at every azimuth', () => {
    for (const azimuth of [0, 1, 1.7, -2.3, Math.PI, Math.PI / 2, 5.9]) {
      const { position } = orbitCamera(ROOFTOP, azimuth)
      const groundDist = Math.hypot(position.x, position.z)
      expect(Math.abs(groundDist - ROOFTOP.radius)).toBeLessThan(1e-9)
    }
  })

  it('returns to the start after a full orbit within 1e-9', () => {
    const start = orbitCamera(ROOFTOP, 0).position
    const full = orbitCamera(ROOFTOP, Math.PI * 2).position
    expect(Math.abs(full.x - start.x)).toBeLessThan(1e-9)
    expect(Math.abs(full.y - start.y)).toBeLessThan(1e-9)
    expect(Math.abs(full.z - start.z)).toBeLessThan(1e-9)
  })

  it('orbits to the opposite side after PI', () => {
    const half = orbitCamera(ROOFTOP, Math.PI).position
    expect(Math.abs(half.z)).toBeCloseTo(ROOFTOP.radius, 12)
    expect(Math.sign(half.z)).not.toBe(Math.sign(ROOFTOP.radius * Math.cos(0)))
    expect(half.x).toBeCloseTo(0, 12)
  })

  it('is deterministic for the same input', () => {
    expect(orbitCamera(ROOFTOP, 1.2345)).toEqual(orbitCamera(ROOFTOP, 1.2345))
  })
})

describe('framesTable', () => {
  it('frames the rooftop table against a 1.5m table', () => {
    expect(framesTable(ROOFTOP, 1.5)).toBe(true)
  })

  it('returns false for a camera whose field does not reach the table', () => {
    const tinyFov: VenueCameraSpec = { radius: 40, height: 4.05, pitchDegrees: 62, fov: 3 }
    expect(framesTable(tinyFov, 1.5)).toBe(false)
  })

  it('frames a small table up close with a wide fov', () => {
    const close: VenueCameraSpec = { radius: 2, height: 1.5, pitchDegrees: 62, fov: 70 }
    expect(framesTable(close, 0.5)).toBe(true)
  })
})
