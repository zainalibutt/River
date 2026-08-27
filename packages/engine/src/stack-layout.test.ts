import { describe, expect, it } from 'vitest'
import type { StackColumn } from './stack-layout.js'
import { DEFAULT_CHIP_DIAMETER, stackLayout } from './stack-layout.js'

function sampleAmounts(count: number): number[] {
  const amounts: number[] = []
  let seed = 0x9e3779b9
  for (let i = 0; i < count; i += 1) {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    amounts.push(seed % 1_500_000)
  }
  return amounts
}

describe('stackLayout', () => {
  it('lays nothing out for zero chips', () => {
    expect(stackLayout(0)).toHaveLength(0)
  })

  it('is total for negative or non-finite amounts', () => {
    expect(stackLayout(-500)).toHaveLength(0)
    expect(stackLayout(Number.NaN)).toHaveLength(0)
    expect(stackLayout(Number.POSITIVE_INFINITY)).toHaveLength(0)
  })

  it('composes the denomination breakdown so nothing is lost for a hundred amounts', () => {
    for (const amount of sampleAmounts(100)) {
      const columns = stackLayout(amount)
      const total = columns.reduce((sum, column) => sum + column.denomination * column.count, 0)
      expect(total).toBe(amount)
    }
  })

  it('caps each column at the max height and spills into a new column', () => {
    const columns = stackLayout(1_000_000, { maxColumnHeight: 5 })
    expect(columns.length).toBeGreaterThan(1)
    for (const column of columns) {
      expect(column.count).toBeLessThanOrEqual(5)
      expect(column.count).toBeGreaterThan(0)
    }
    const total = columns.reduce((sum, column) => sum + column.denomination * column.count, 0)
    expect(total).toBe(1_000_000)
  })

  it('keeps adjacent columns at least a chip diameter apart for a hundred amounts', () => {
    for (const amount of sampleAmounts(100)) {
      const columns = stackLayout(amount)
      for (let i = 1; i < columns.length; i += 1) {
        const prev = columns[i - 1] as { offsetX: number }
        const current = columns[i] as { offsetX: number }
        // Within a float tick of the diameter. offsetX is order * spacing, so
        // the difference of two exact multiples lands an ulp either side of it
        // once the ladder is short enough to make ten columns - which is a
        // rounding artefact, not two chips overlapping by 10 picometres.
        expect(current.offsetX - prev.offsetX).toBeGreaterThanOrEqual(DEFAULT_CHIP_DIAMETER - 1e-9)
      }
    }
  })

  it('places the highest denomination column first (nearest the player)', () => {
    const columns = stackLayout(1_234_567)
    const values = columns.map((column) => column.denomination)
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i - 1]).toBeGreaterThanOrEqual(values[i] as number)
    }
  })

  it('lays columns left to right with configurable spacing', () => {
    const columns = stackLayout(1_000_000, { maxColumnHeight: 20, spacing: 0.05 })
    for (let i = 1; i < columns.length; i += 1) {
      const prev = columns[i - 1] as StackColumn
      const current = columns[i] as StackColumn
      expect(current.offsetX).toBeGreaterThan(prev.offsetX)
    }
  })

  it('never dips below a chip diameter even if spacing is too small', () => {
    const columns = stackLayout(1_000_000, { spacing: 0.01 })
    for (let i = 1; i < columns.length; i += 1) {
      const prev = columns[i - 1] as { offsetX: number }
      const current = columns[i] as { offsetX: number }
      expect(current.offsetX - prev.offsetX).toBeGreaterThanOrEqual(DEFAULT_CHIP_DIAMETER - 1e-9)
    }
  })

  it('is deterministic for identical input', () => {
    expect(stackLayout(137_500)).toEqual(stackLayout(137_500))
  })
})
