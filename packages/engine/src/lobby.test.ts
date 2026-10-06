import { describe, expect, it } from 'vitest'
import type { TableStatus, TableSummary } from './lobby.js'
import { bestTableFor, filterTables, sortTables, tableStatus } from './lobby.js'

const STATUSES: readonly TableStatus[] = ['open', 'in-hand', 'full', 'empty']

describe('tableStatus', () => {
  it('returns exactly one status for every seat, table, hand and in-hand combination', () => {
    for (let taken = 0; taken <= 3; taken += 1) {
      for (let total = 0; total <= 3; total += 1) {
        for (let hand = 0; hand <= 2; hand += 1) {
          for (const inHand of [false, true]) {
            const status = tableStatus(taken, total, hand, inHand)
            expect(STATUSES).toContain(status)
          }
        }
      }
    }
  })

  it('handles a 0 of 0 seat table deterministically', () => {
    expect(STATUSES).toContain(tableStatus(0, 0, 0, false))
  })

  it('reports a full table as full even while a hand is live', () => {
    expect(tableStatus(6, 6, 2, true)).toBe('full')
    expect(tableStatus(3, 3, 1, true)).toBe('full')
  })

  it('reports an empty table as empty', () => {
    expect(tableStatus(0, 6, 0, false)).toBe('empty')
    expect(tableStatus(0, 6, 3, true)).toBe('empty')
  })

  it('reports in-hand when a hand is live and seats remain', () => {
    expect(tableStatus(2, 6, 1, true)).toBe('in-hand')
    expect(tableStatus(2, 6, 1, false)).toBe('in-hand')
  })

  it('reports open otherwise', () => {
    expect(tableStatus(2, 6, 0, false)).toBe('open')
  })
})

describe('filterTables', () => {
  const tables = [
    table('a', { venueId: 'rooftop', bigBlind: 500, status: 'in-hand', seatsTaken: 3 }),
    table('b', { venueId: 'basement', bigBlind: 200, status: 'open', seatsTaken: 4 }),
    table('c', { venueId: 'suite', bigBlind: 1000, status: 'full', seatsTaken: 9 }),
    table('d', { venueId: 'rooftop', bigBlind: 100, status: 'empty', seatsTaken: 0 }),
  ]

  it('returns every table in original order for an empty filter, without mutating input', () => {
    const result = filterTables(tables, {})
    expect(result.map((t) => t.roomId)).toEqual(['a', 'b', 'c', 'd'])
    expect(result).not.toBe(tables)
    expect(tables.map((t) => t.roomId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('narrows by venue', () => {
    const result = filterTables(tables, { venueId: 'rooftop' })
    expect(result.map((t) => t.roomId)).toEqual(['a', 'd'])
  })

  it('narrows by maxBigBlind', () => {
    const result = filterTables(tables, { maxBigBlind: 500 })
    expect(result.map((t) => t.roomId)).toEqual(['a', 'b', 'd'])
  })

  it('combines venue and maxBigBlind', () => {
    const result = filterTables(tables, { venueId: 'rooftop', maxBigBlind: 300 })
    expect(result.map((t) => t.roomId)).toEqual(['d'])
  })

  it('hides full tables', () => {
    const result = filterTables(tables, { hideFull: true })
    expect(result.map((t) => t.roomId)).toEqual(['a', 'b', 'd'])
  })

  it('hides empty tables', () => {
    const result = filterTables(tables, { hideEmpty: true })
    expect(result.map((t) => t.roomId)).toEqual(['a', 'b', 'c'])
  })
})

describe('sortTables', () => {
  it('sorts seats-desc by seats taken', () => {
    const tables = [
      table('a', { seatsTaken: 2 }),
      table('b', { seatsTaken: 5 }),
      table('c', { seatsTaken: 1 }),
    ]
    expect(sortTables(tables, 'seats-desc').map((t) => t.seatsTaken)).toEqual([5, 2, 1])
  })

  it('sorts stake-asc and stake-desc by big blind, without mutating input', () => {
    const tables = [
      table('a', { bigBlind: 1000 }),
      table('b', { bigBlind: 200 }),
      table('c', { bigBlind: 500 }),
    ]
    const before = tables.map((t) => t.roomId)
    expect(sortTables(tables, 'stake-asc').map((t) => t.bigBlind)).toEqual([200, 500, 1000])
    expect(sortTables(tables, 'stake-desc').map((t) => t.bigBlind)).toEqual([1000, 500, 200])
    expect(tables.map((t) => t.roomId)).toEqual(before)
  })

  it('sorts venue in a fixed order', () => {
    const tables = [
      table('a', { venueId: 'suite' }),
      table('b', { venueId: 'rooftop' }),
      table('c', { venueId: 'basement' }),
    ]
    expect(sortTables(tables, 'venue').map((t) => t.venueId)).toEqual([
      'rooftop',
      'basement',
      'suite',
    ])
  })

  it('is stable across equal keys', () => {
    const tables = [
      table('a', { bigBlind: 500, seatsTaken: 3 }),
      table('b', { bigBlind: 200, seatsTaken: 4 }),
      table('c', { bigBlind: 500, seatsTaken: 1 }),
    ]
    expect(sortTables(tables, 'stake-asc').map((t) => t.roomId)).toEqual(['b', 'a', 'c'])
  })
})

describe('bestTableFor', () => {
  it('returns null for an empty list', () => {
    expect(bestTableFor([], 1_000_000)).toBeNull()
  })

  it('returns null when the bankroll cannot buy into any stake', () => {
    const tables = [table('a', { bigBlind: 500 }), table('b', { bigBlind: 200 })]
    expect(bestTableFor(tables, 20_000)).toBeNull()
    expect(bestTableFor(tables, 39_999)).toBeNull()
  })

  it('never returns a table the bankroll cannot buy into', () => {
    const tables = [
      table('a', { bigBlind: 500, seatsTaken: 6 }),
      table('b', { bigBlind: 1000, seatsTaken: 4 }),
    ]
    expect(bestTableFor(tables, 100_000)?.roomId).toBe('a')
    expect(bestTableFor(tables, 99_999)).toBeNull()
  })

  it('prefers a seated table over an empty one at equal stake', () => {
    const tables = [
      table('a', { bigBlind: 500, seatsTaken: 0 }),
      table('b', { bigBlind: 500, seatsTaken: 3 }),
    ]
    expect(bestTableFor(tables, 1_000_000)?.roomId).toBe('b')
  })

  it('chooses the most populated seated table it can afford', () => {
    const tables = [
      table('a', { bigBlind: 1000, seatsTaken: 5 }),
      table('b', { bigBlind: 500, seatsTaken: 4 }),
      table('c', { bigBlind: 500, seatsTaken: 1 }),
    ]
    expect(bestTableFor(tables, 60_000)).toBeNull()
    expect(bestTableFor(tables, 100_000)?.roomId).toBe('b')
    expect(bestTableFor(tables, 1_000_000)?.roomId).toBe('a')
  })
})

function table(id: string, partial: Partial<TableSummary>): TableSummary {
  return {
    roomId: id,
    venueId: 'rooftop',
    stakeId: '250-500',
    smallBlind: 250,
    bigBlind: 500,
    seatsTaken: 6,
    seatsTotal: 9,
    handNumber: 0,
    status: 'open',
    hasPassword: false,
    ...partial,
  }
}
