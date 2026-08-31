import { describe, expect, it } from 'vitest'
import { affordableBuyIn } from './buy-in'

describe('affordable table entry', () => {
  it('uses the standard buy-in when the bankroll covers it', () => {
    expect(affordableBuyIn(175_000, 50_000, 100_000)).toBe(100_000)
  })

  it('lets a player enter between the legal minimum and standard buy-in', () => {
    expect(affordableBuyIn(51_750, 50_000, 100_000)).toBe(51_750)
  })

  it('does not offer an illegal short buy-in', () => {
    expect(affordableBuyIn(49_999, 50_000, 100_000)).toBeNull()
  })

  it('rejects a balance that cannot become a valid integer command', () => {
    expect(affordableBuyIn(Number.NaN, 50_000, 100_000)).toBeNull()
  })
})
