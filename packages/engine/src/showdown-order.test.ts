import { describe, expect, it } from 'vitest'
import type { RevealStep, ShowdownSeat } from './showdown-order.js'
import { mustShow, revealOrder } from './showdown-order.js'

function seat(partial: Partial<ShowdownSeat>): ShowdownSeat {
  return {
    seat: 1,
    folded: false,
    allIn: false,
    handRank: null,
    lastAggressorOnRiver: false,
    ...partial,
  }
}

describe('revealOrder', () => {
  it('puts the river aggressor at order 0 even when a lower seat number is live', () => {
    const steps = revealOrder([
      seat({ seat: 2, handRank: 4 }),
      seat({ seat: 7, handRank: 9, lastAggressorOnRiver: true }),
    ])
    expect(steps[0]?.seat).toBe(7)
    expect(steps[0]?.order).toBe(0)
    expect(steps[1]?.seat).toBe(2)
  })

  it('puts the lowest live seat at order 0 when nobody bet the river', () => {
    const steps = revealOrder([
      seat({ seat: 6, handRank: 5 }),
      seat({ seat: 3, handRank: 8 }),
      seat({ seat: 9, handRank: 7 }),
    ])
    expect(steps[0]?.seat).toBe(3)
  })

  it('never emits a folded seat', () => {
    const folded = seat({ seat: 4, folded: true, handRank: 99 })
    const steps = revealOrder([
      folded,
      seat({ seat: 1, handRank: 6, lastAggressorOnRiver: true }),
      seat({ seat: 5, handRank: 8 }),
    ])
    expect(steps.some((step) => step.seat === folded.seat)).toBe(false)
  })

  it('sets every all-in seat to forced, including a losing one', () => {
    const steps = revealOrder([
      seat({ seat: 2, handRank: 8, allIn: true, lastAggressorOnRiver: true }),
      seat({ seat: 5, handRank: 3, allIn: true }),
      seat({ seat: 6, handRank: 5 }),
    ])
    const allInSeats = steps.filter((step) => step.seat === 2 || step.seat === 5)
    for (const step of allInSeats) {
      expect(step.decision).toBe('forced')
    }
    expect(mustShow(getStep(steps, 5))).toBe(true)
  })

  it('marks a seat that beats everything shown as forced', () => {
    const steps = revealOrder([
      seat({ seat: 1, handRank: 7, lastAggressorOnRiver: true }),
      seat({ seat: 2, handRank: 9 }),
    ])
    expect(getStep(steps, 2).decision).toBe('forced')
    expect(getStep(steps, 2).beatsShownSoFar).toBe(true)
  })

  it('marks a seat strictly behind everything shown as muck', () => {
    const steps = revealOrder([
      seat({ seat: 1, handRank: 7, lastAggressorOnRiver: true }),
      seat({ seat: 4, handRank: 2 }),
    ])
    expect(getStep(steps, 4).decision).toBe('muck')
    expect(getStep(steps, 4).beatsShownSoFar).toBe(false)
  })

  it('marks a tie as show, never muck', () => {
    const steps = revealOrder([
      seat({ seat: 1, handRank: 7, lastAggressorOnRiver: true }),
      seat({ seat: 3, handRank: 7 }),
    ])
    expect(getStep(steps, 3).decision).toBe('show')
  })

  it('produces contiguous 0..n-1 orders with no gaps or duplicates for several counts', () => {
    for (let count = 1; count <= 5; count += 1) {
      const seats: ShowdownSeat[] = []
      for (let s = 0; s < count; s += 1) {
        seats.push(seat({ seat: s + 10, handRank: s + 1, lastAggressorOnRiver: s === 0 }))
      }
      const steps = revealOrder(seats)
      expect(steps).toHaveLength(count)
      for (let i = 0; i < count; i += 1) {
        expect(steps[i]?.order).toBe(i)
      }
    }
  })

  it('produces one valid step for a single live seat', () => {
    const steps = revealOrder([seat({ seat: 2, handRank: 6 })])
    expect(steps).toHaveLength(1)
    expect(steps[0]?.order).toBe(0)
    expect(steps[0]?.decision).toBe('forced')
    expect(mustShow(steps[0] as RevealStep)).toBe(true)
  })

  it('returns an empty list for an all-folded input rather than throwing', () => {
    const steps = revealOrder([
      seat({ seat: 1, folded: true, handRank: 4 }),
      seat({ seat: 2, folded: true, handRank: 8 }),
    ])
    expect(steps).toHaveLength(0)
  })
})

function getStep(steps: readonly RevealStep[], seatNo: number): RevealStep {
  const step = steps.find((s) => s.seat === seatNo)
  if (step === undefined) throw new Error(`no step for seat ${seatNo}`)
  return step
}
