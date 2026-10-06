import { describe, expect, it } from 'vitest'
import { phoneGeometry, phoneKeyboardInset, phoneViewport } from './phone-layout'
import { overlaps, tableLayout } from './table-2d-geometry'

describe('phone table composition', () => {
  it('uses upright phones without changing desktop or sideways layouts', () => {
    expect(phoneViewport(390, 844)).toBe(true)
    expect(phoneViewport(360, 800)).toBe(true)
    expect(phoneViewport(844, 390)).toBe(false)
    expect(phoneViewport(1920, 1080)).toBe(false)
  })

  it('keeps sheets above the keyboard', () => {
    expect(phoneKeyboardInset(844, 544, 0)).toBe(300)
    expect(phoneKeyboardInset(844, 544, 20)).toBe(280)
    expect(phoneKeyboardInset(844, 844, 0)).toBe(0)
    expect(phoneKeyboardInset(844, 900, 0)).toBe(0)
  })

  it('anchors every possible hero seat at the foot', () => {
    for (let hero = 0; hero < 9; hero += 1) {
      const seat = tableLayout(phoneGeometry(390, 844), 9, hero).seats[hero]
      expect(seat).toBeDefined()
      if (seat === undefined) continue
      expect(seat.foot).toBe(true)
      expect(seat.placard.x).toBeCloseTo(seat.placardBox.x + 50)
    }
  })

  it('puts the heads-up opponent directly opposite either hero seat', () => {
    for (const hero of [0, 1]) {
      const geometry = phoneGeometry(390, 844)
      const layout = tableLayout(geometry, 2, hero)
      expect(layout.headsUp).toBe(true)
      for (const seat of layout.seats) {
        expect(seat.placard.x).toBeCloseTo(geometry.centre.x)
        expect(seat.foot).toBe(seat.seat === hero)
        if (!seat.foot) expect(seat.placard.y).toBeLessThan(geometry.centre.y)
      }
    }
    expect(tableLayout(phoneGeometry(390, 844), 9, 0).headsUp).toBe(false)
  })

  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [360, 800 - 81],
    [390, 844 - 81],
  ] as const) {
    for (const count of [2, 6, 9]) {
      it(`keeps ${count} seats readable and separate at ${width} by ${height}`, () => {
        const geometry = phoneGeometry(width, height)
        const seats = tableLayout(geometry, count, 0).seats.filter((seat) => seat.seat !== 0)
        for (const seat of seats) {
          expect(seat.placardBox.width).toBeGreaterThanOrEqual(44)
          expect(seat.placardBox.height).toBeGreaterThanOrEqual(44)
          expect(seat.placardBox.x).toBeGreaterThanOrEqual(0)
          expect(seat.placardBox.x + seat.placardBox.width).toBeLessThanOrEqual(width)
          expect(seat.placardBox.y).toBeGreaterThanOrEqual(0)
          expect(seat.placardBox.y + seat.placardBox.height).toBeLessThanOrEqual(
            geometry.stage.height,
          )
          for (const other of seats) {
            if (seat.seat !== other.seat)
              expect(overlaps(seat.placardBox, other.placardBox)).toBe(false)
          }
        }
      })
    }
  }
})
