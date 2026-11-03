import { describe, expect, it } from 'vitest'
import { fittedFontSize } from './fit-text'

describe('fitting a line of text to its room', () => {
  it('leaves text that already fits at its own size', () => {
    expect(fittedFontSize(12, 72, 40, 8)).toBe(12)
    expect(fittedFontSize(12, 72, 72, 8)).toBe(12)
  })

  it('shrinks text that overflows in proportion, in half pixels, so it fits', () => {
    // A twelve-letter name: 77px at 12px in a 72px plate.
    const size = fittedFontSize(12, 72, 77, 8)
    expect(size).toBe(11)
    expect((77 * size) / 12).toBeLessThanOrEqual(72)
    // Sixteen letters: about 103px.
    expect(fittedFontSize(12, 72, 103, 8)).toBe(8)
  })

  it('stops at the floor, leaving the rest to the ellipsis', () => {
    expect(fittedFontSize(12, 72, 200, 8)).toBe(8)
  })

  it('does nothing with a measurement that means nothing', () => {
    expect(fittedFontSize(12, 0, 77, 8)).toBe(12)
    expect(fittedFontSize(12, 72, Number.NaN, 8)).toBe(12)
  })
})
