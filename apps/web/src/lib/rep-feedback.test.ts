import type { RoomEvent } from '@river/server'
import { describe, expect, it } from 'vitest'
import { repFlashFor, shouldShowRate } from './rep-feedback.js'

function awarded(
  playerId: string,
  over: Partial<{ totalRep: number; rate: number; before: number; after: number }> = {},
): RoomEvent {
  return {
    kind: 'repAwarded',
    handNumber: 7,
    awards: [
      {
        playerId,
        totalRep: over.totalRep ?? 52,
        earningRatePercent: over.rate ?? 100,
        levelBefore: over.before ?? 3,
        levelAfter: over.after ?? 3,
      },
    ],
  }
}

describe('rep feedback', () => {
  it('returns nothing when no rep was awarded', () => {
    expect(repFlashFor([], 'alice')).toBeNull()
  })

  it('picks out your own award', () => {
    expect(repFlashFor([awarded('alice')], 'alice')?.totalRep).toBe(52)
  })

  it('returns nothing when the award was not yours', () => {
    expect(repFlashFor([awarded('bob')], 'alice')).toBeNull()
  })

  it('reports a level jump of more than one', () => {
    const flash = repFlashFor([awarded('alice', { before: 3, after: 5 })], 'alice')
    expect(flash?.levelUp).toBe(2)
  })

  it('never reports a negative level change', () => {
    const flash = repFlashFor([awarded('alice', { before: 5, after: 3 })], 'alice')
    expect(flash?.levelUp).toBe(0)
  })

  it('keys the flash by hand so the same award does not replay', () => {
    const first = repFlashFor([awarded('alice')], 'alice')
    const again = repFlashFor([awarded('alice')], 'alice')
    expect(first?.id).toBe(again?.id)
  })

  it('stays quiet about a plain 100 percent rate', () => {
    expect(shouldShowRate(100)).toBe(false)
    expect(shouldShowRate(120)).toBe(true)
    expect(shouldShowRate(85)).toBe(true)
  })
})
