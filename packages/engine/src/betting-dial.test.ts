import { describe, expect, it } from 'vitest'
import type { DialInput, DialRange } from './betting-dial.js'
import { dialRanges, nearestRange, stepRange } from './betting-dial.js'

describe('dialRanges', () => {
  const INPUT: DialInput = {
    pot: 100,
    toCall: 50,
    minRaiseTo: 100,
    maxRaiseTo: 1000,
    stack: 4000,
  }

  it('sizes a pot raise as toCall + pot + toCall', () => {
    const ranges = dialRanges(INPUT)
    const potRange = ranges.find((range) => range.id === 'fraction:POT')
    expect(potRange?.amount).toBe(50 + 100 + 50)
  })

  it('returns ranges ascending by amount', () => {
    const ranges = dialRanges(INPUT)
    const amounts = ranges.map((range) => range.amount)
    const sortedAscending = [...amounts].sort((a, b) => a - b)
    expect(amounts).toEqual(sortedAscending)
  })

  it('returns no duplicate amounts', () => {
    const ranges = dialRanges(INPUT)
    const amounts = ranges.map((range) => range.amount)
    expect(new Set(amounts).size).toBe(amounts.length)
  })

  it('collapses two fractions that land on the same amount into one range', () => {
    const ranges = dialRanges({ pot: 0, toCall: 2, minRaiseTo: 1, maxRaiseTo: 1000, stack: 4000 })
    const fractions = ranges.filter((range) => range.id.startsWith('fraction:'))
    expect(fractions.length).toBe(5)
    const amounts = fractions.map((range) => range.amount)
    expect(new Set(amounts).size).toBe(amounts.length)
  })

  it('keeps a range below minRaiseTo present but marked illegal', () => {
    const ranges = dialRanges({
      pot: 10,
      toCall: 50,
      minRaiseTo: 150,
      maxRaiseTo: 1000,
      stack: 4000,
    })
    const halfPot = ranges.find((range) => range.id === 'fraction:1/2 POT')
    expect(halfPot).toBeDefined()
    expect(halfPot?.amount).toBeLessThan(150)
    expect(halfPot?.legal).toBe(false)
    expect(ranges.some((range) => range.legal === true)).toBe(true)
  })

  it('always sets ALL IN to maxRaiseTo, including when stack is tiny', () => {
    const ranges = dialRanges({ pot: 100, toCall: 50, minRaiseTo: 55, maxRaiseTo: 60, stack: 60 })
    const allIn = ranges.find((range) => range.id === 'allin')
    expect(allIn?.amount).toBe(60)
    expect(allIn?.legal).toBe(true)
  })

  it('returns a usable dial when minRaiseTo equals maxRaiseTo', () => {
    const ranges = dialRanges({ ...INPUT, minRaiseTo: 60, maxRaiseTo: 60 })
    expect(ranges.length).toBeGreaterThan(0)
    const allIn = ranges.find((range) => range.id === 'allin')
    expect(allIn?.amount).toBe(60)
    expect(allIn?.legal).toBe(true)
    expect(ranges.every((range) => range.amount <= 60 || range.legal === false)).toBe(true)
  })

  it('returns every amount as a whole number', () => {
    const ranges = dialRanges(INPUT)
    for (const range of ranges) {
      expect(Number.isInteger(range.amount)).toBe(true)
    }
  })

  it('never produces NaN for a zero pot and zero toCall', () => {
    const ranges = dialRanges({ pot: 0, toCall: 0, minRaiseTo: 5, maxRaiseTo: 100, stack: 500 })
    for (const range of ranges) {
      expect(Number.isNaN(range.amount)).toBe(false)
    }
  })
})

describe('nearestRange', () => {
  const RANGES: readonly DialRange[] = [
    { id: 'a', label: 'A', amount: 10, legal: true },
    { id: 'b', label: 'B', amount: 30, legal: true },
    { id: 'c', label: 'C', amount: 50, legal: true },
  ]

  it('picks the closest by absolute difference', () => {
    expect(nearestRange(RANGES, 25)?.id).toBe('b')
    expect(nearestRange(RANGES, 11)?.id).toBe('a')
    expect(nearestRange(RANGES, 39)?.id).toBe('b')
  })

  it('returns null for an empty list', () => {
    expect(nearestRange([], 10)).toBeNull()
  })
})

describe('stepRange', () => {
  const RANGES: readonly DialRange[] = [
    { id: 'a', label: 'A', amount: 10, legal: true },
    { id: 'b', label: 'B', amount: 30, legal: true },
    { id: 'c', label: 'C', amount: 50, legal: true },
  ]

  it('steps to the next range in direction', () => {
    expect(stepRange(RANGES, 'a', 1)?.id).toBe('b')
    expect(stepRange(RANGES, 'c', -1)?.id).toBe('b')
  })

  it('clamps at the first range when stepping down past the end', () => {
    expect(stepRange(RANGES, 'a', -1)?.id).toBe('a')
  })

  it('clamps at the last range when stepping up past the end', () => {
    expect(stepRange(RANGES, 'c', 1)?.id).toBe('c')
  })
})
