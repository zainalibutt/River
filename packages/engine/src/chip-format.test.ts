import { describe, expect, it } from 'vitest'
import { formatChips } from './chip-format.js'

const SUFFIX_VALUE: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }

function numericValue(formatted: string): number {
  const cleaned = formatted.replace(/[~,]/g, '')
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)([KMBT])?$/)
  if (match === null) return 0
  const number = Number(match[1])
  const suffix = match[2]
  return number * (suffix === undefined ? 1 : (SUFFIX_VALUE[suffix] ?? 1))
}

describe('formatChips', () => {
  it('writes under 10,000 in full with separators', () => {
    expect(formatChips(0)).toBe('0')
    expect(formatChips(900)).toBe('900')
    expect(formatChips(4250)).toBe('4,250')
    expect(formatChips(9999)).toBe('9,999')
  })

  it('floors fractional chips toward zero', () => {
    expect(formatChips(4250.9)).toBe('4,250')
    expect(formatChips(-4250.9)).toBe('-4,250')
  })

  it('is exact at the 10,000 boundary', () => {
    expect(formatChips(9999)).toBe('9,999')
    expect(formatChips(10000)).toBe('10K')
  })

  it('writes 10,000 and above in short form with default precision 2', () => {
    expect(formatChips(10000)).toBe('10K')
    expect(formatChips(22071)).toBe('22.07K')
    expect(formatChips(1400000)).toBe('1.4M')
    expect(formatChips(1000000000)).toBe('1B')
  })

  it('drops trailing zeroes', () => {
    expect(formatChips(10000)).toBe('10K')
    expect(formatChips(22100)).toBe('22.1K')
    expect(formatChips(22000)).toBe('22K')
  })

  it('honours a custom precision', () => {
    expect(formatChips(22071, { precision: 3 })).toBe('22.071K')
  })

  it('approximate rounds to one significant decimal with a tilde and minimal precision', () => {
    expect(formatChips(22000, { approximate: true })).toBe('~22K')
    expect(formatChips(22071, { approximate: true })).toBe('~22.1K')
    expect(formatChips(1400000, { approximate: true })).toBe('~1.4M')
    expect(formatChips(999999, { approximate: true })).toBe('~1M')
  })

  it('preserves the sign of negative amounts', () => {
    expect(formatChips(-4250)).toBe('-4,250')
    expect(formatChips(-22071)).toBe('-22.07K')
  })

  it('is total for non-finite input', () => {
    expect(formatChips(Number.NaN)).toBe('0')
    expect(formatChips(Number.POSITIVE_INFINITY)).toBe('0')
    expect(formatChips(Number.NEGATIVE_INFINITY)).toBe('0')
  })

  it('never leaks precision in approximate output', () => {
    for (let amount = 0; amount < 1_000_000; amount += 137) {
      const formatted = formatChips(amount, { approximate: true })
      const cleaned = formatted.replace(/^~/, '').replace(/[KMBT]$/, '')
      const fractional = cleaned.includes('.') ? (cleaned.split('.')[1]?.length ?? 0) : 0
      expect(fractional).toBeLessThanOrEqual(1)
    }
  })

  it('is monotonic in the numeric part across increasing amounts', () => {
    let previous = Number.NEGATIVE_INFINITY
    for (let amount = 0; amount < 2_000_000; amount += 137) {
      const value = numericValue(formatChips(amount))
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it('is deterministic for identical input', () => {
    expect(formatChips(22071)).toBe(formatChips(22071))
    expect(formatChips(22071, { approximate: true })).toBe(
      formatChips(22071, { approximate: true }),
    )
  })
})
