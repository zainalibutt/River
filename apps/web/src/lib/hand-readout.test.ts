import type { Card } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { readoutFor } from './hand-readout'

const card = (text: string): Card => ({
  rank: text.slice(0, -1) as Card['rank'],
  suit: text.slice(-1) as Card['suit'],
})
const hand = (text: string): Card[] => text.split(' ').map(card)

describe('readoutFor', () => {
  it('names the made hand once five cards exist', () => {
    const readout = readoutFor(hand('Ks Kh'), hand('8d 8c 2s'))
    expect(readout?.full.toLowerCase()).toContain('two pair')
    expect(readout?.short.length).toBeLessThan(16)
  })

  it('says nothing before there is a hand to name', () => {
    // Naming "ace high" over two hole cards claims a hand the player has not
    // been dealt yet.
    expect(readoutFor(hand('As Kd'), [])).toBeNull()
    expect(readoutFor(hand('As Kd'), hand('2c 3d'))).toBeNull()
  })

  it('says nothing when the player is not holding cards', () => {
    expect(readoutFor([], hand('As Kd 2c 3d 4h'))).toBeNull()
  })

  it('uses the best five of seven', () => {
    const readout = readoutFor(hand('As Ks'), hand('Qs Js Ts 2c 3d'))
    expect(readout?.full.toLowerCase()).toContain('royal')
  })

  it('gives the same words for the same cards', () => {
    expect(readoutFor(hand('7s 7h'), hand('7d 2c 3d'))).toEqual(
      readoutFor(hand('7s 7h'), hand('7d 2c 3d')),
    )
  })
})
