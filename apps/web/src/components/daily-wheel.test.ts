import { describe, expect, it } from 'vitest'
import { wheelRotation } from './daily-wheel'

describe('wheelRotation', () => {
  it('brings each segment centre under the top pointer after whole turns', () => {
    for (let segment = 0; segment < 5; segment += 1) {
      const rotation = wheelRotation(segment, 5)
      // Where the segment's centre ends up, measured clockwise from twelve o'clock.
      const centre = (segment * 72 + 36 + rotation) % 360
      expect(centre).toBe(0)
      expect(rotation).toBeGreaterThan(4 * 360)
    }
  })
})
