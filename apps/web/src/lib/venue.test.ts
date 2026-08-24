import { describe, expect, it } from 'vitest'
import { rooftopCamera, worldSeats } from './venue.js'

describe('worldSeats', () => {
  it('keeps the local player at the near edge and spaces seats around the table', () => {
    const seats = worldSeats(['you', 'bot'])
    expect(seats[0]).toMatchObject({ id: 'you', z: -3.05 })
    expect(seats[0]?.x).toBeCloseTo(0)
    expect(seats[1]).toMatchObject({ id: 'bot', z: 3.05 })
    expect(seats[1]?.x).toBeCloseTo(0)
  })
})

describe('rooftopCamera', () => {
  it('uses the measured rooftop orbit', () => {
    expect(rooftopCamera).toEqual({ radius: 6.1, height: 4.05, pitchDegrees: 62, fov: 64 })
  })
})
