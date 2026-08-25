import { describe, expect, it } from 'vitest'
import type { ChipStack } from './chip-stacks.js'
import { breakStack, denominations, readableStacks, stackCount, stackValue } from './chip-stacks.js'

describe('denominations', () => {
  it('are ascending, unique, and the smallest divides every larger value', () => {
    const values = denominations().map((denomination) => denomination.value)
    expect(values.length).toBeGreaterThanOrEqual(5)
    expect([...values].sort((a, b) => a - b)).toEqual(values)
    expect(new Set(values).size).toBe(values.length)
    const smallest = Math.min(...values)
    for (const value of values) {
      expect(value % smallest).toBe(0)
    }
  })

  it('label every entry with a plain label and a hashless hex colour', () => {
    for (const denomination of denominations()) {
      expect(denomination.label.length).toBeGreaterThan(0)
      expect(denomination.colour).toMatch(/^[0-9a-f]{6}$/)
    }
  })
})

describe('breakStack', () => {
  it('sums exactly for a wide sweep of amounts', () => {
    const amounts = [0, 1, 7, 25, 99, 250, 999, 137_500, 99_999, 200_000, 1_000_000, 2_550_000]
    for (const amount of amounts) {
      expect(stackValue(breakStack(amount))).toBe(amount)
    }
  })

  it('covers maximum bankrolls without losing exactness', () => {
    for (let amount = 0; amount <= 1_000_000; amount += 997) {
      expect(stackValue(breakStack(amount))).toBe(amount)
    }
    expect(stackValue(breakStack(1_000_000))).toBe(1_000_000)
  })

  it('uses the largest denominations first', () => {
    const stacks = breakStack(137_500)
    expect(stacks[0]?.denomination.value).toBe(100_000)
    for (let i = 1; i < stacks.length; i += 1) {
      expect((stacks[i] as ChipStack).denomination.value).toBeLessThanOrEqual(
        (stacks[i - 1] as ChipStack).denomination.value,
      )
    }
  })

  it('splits a single amount of one very rich stack into affordable stacks', () => {
    const stacks = breakStack(1_000_000, 4)
    const hundreds = stacks.filter((stack) => stack.denomination.value === 100_000)
    expect(hundreds).toHaveLength(3)
    for (const stack of hundreds) {
      expect(stack.count).toBeLessThanOrEqual(4)
    }
    expect(stackValue(stacks)).toBe(1_000_000)
  })

  it('never exceeds maxPerStack per column and overflows into more stacks', () => {
    const stacks = breakStack(4_100_000, 40)
    const hundreds = stacks.filter((stack) => stack.denomination.value === 100_000)
    expect(hundreds).toHaveLength(2)
    expect(hundreds[0]?.count).toBe(40)
    expect(hundreds[1]?.count).toBe(1)
    expect(stackValue(stacks)).toBe(4_100_000)
  })

  it('returns an empty list for zero', () => {
    expect(breakStack(0)).toHaveLength(0)
  })

  it('clamps negative amounts to an empty list', () => {
    expect(breakStack(-100)).toHaveLength(0)
  })

  it('never creates negative or zero counts', () => {
    const amounts = [-50, -1, 0, 1, 3, 100, 999, 5_000, 50_000, 137_500, 200_000]
    for (const amount of amounts) {
      const stacks = breakStack(amount)
      for (const stack of stacks) {
        expect(stack.count).toBeGreaterThan(0)
      }
    }
  })
})

describe('readableStacks', () => {
  it('never exceeds its chip cap', () => {
    for (let amount = 0; amount <= 500_000; amount += 997) {
      for (const cap of [1, 2, 5, 17, 60]) {
        const stacks = readableStacks(amount, cap)
        expect(stackCount(stacks)).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('reports a value a caller can compare against the true amount', () => {
    const amount = 99_999
    const stacks = readableStacks(amount, 4)
    const represented = stackValue(stacks)
    expect(represented).toBeLessThanOrEqual(amount)
    expect(represented).toBeGreaterThan(0)
    expect(stackCount(stacks)).toBeLessThanOrEqual(4)
  })

  it('represents the full amount when the budget is large enough', () => {
    const amount = 137_500
    const stacks = readableStacks(amount, 100)
    expect(stackValue(stacks)).toBe(amount)
  })

  it('chooses the closest representation under a tight cap', () => {
    const stacks = readableStacks(99_999, 5)
    const represented = stackValue(stacks)
    expect(represented).toBe(85_000)
    expect(stackCount(stacks)).toBe(5)
  })

  it('returns an empty list for non-positive amounts or caps', () => {
    expect(readableStacks(0, 5)).toHaveLength(0)
    expect(readableStacks(100, 0)).toHaveLength(0)
    expect(readableStacks(-1, 5)).toHaveLength(0)
    expect(readableStacks(100, -3)).toHaveLength(0)
  })
})

describe('stackCount and stackValue', () => {
  it('counts chips and sums values across mixed stacks', () => {
    const stacks: readonly ChipStack[] = [
      { denomination: { value: 25, label: '25', colour: '2e7d32' }, count: 4 },
      { denomination: { value: 1000, label: '1K', colour: '1565c0' }, count: 2 },
    ]
    expect(stackCount(stacks)).toBe(6)
    expect(stackValue(stacks)).toBe(4 * 25 + 2 * 1000)
  })

  it('returns zero for an empty list', () => {
    expect(stackCount([])).toBe(0)
    expect(stackValue([])).toBe(0)
  })
})
