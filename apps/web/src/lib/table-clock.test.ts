import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetTableClock, setTableRate, tableNow, tableRate } from './table-clock'

describe('the table clock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetTableClock()
  })

  it('runs with real time in play, and changes speed without jumping', () => {
    let real = 1_000
    vi.spyOn(performance, 'now').mockImplementation(() => real)
    expect(tableNow()).toBe(1_000)
    setTableRate(0.25)
    real += 400
    expect(tableNow()).toBe(1_100)
    setTableRate(0)
    real += 1_000
    expect(tableNow()).toBe(1_100)
    expect(tableRate()).toBe(0)
    setTableRate(2)
    real += 50
    expect(tableNow()).toBe(1_200)
  })
})
