import { type Card, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { LbrQueryMemo, memoLbrSolve, withLbrQueryMemo } from './bot-lbr-query.js'
import { prepare } from './bot-river-solver.js'
import { turnRivers } from './bot-turn-end-data.js'
import { runoutShowdownTable, showdownTable } from './bot-turn-solver.js'

describe('disposable query solve memo', () => {
  it('reuses all-in preparation with independent reaches and complete holding/runout keys', () => {
    const board = ['Ah', 'Kd', '7s', '4c'].map(parseCard)
    const holding = (first: string, second: string) => ({
      hole: [parseCard(first), parseCard(second)] as [Card, Card],
      weight: 1,
    })
    const hands = [
      prepare([holding('8s', '8h'), holding('Qc', 'Jc')], board),
      prepare([holding('7c', '7d'), holding('Kc', 'Qh')], board),
    ] as const
    const rivers = turnRivers(board)
    for (const make of [
      () => showdownTable(rivers, hands),
      () => runoutShowdownTable(rivers.rivers, hands),
    ]) {
      const memo = new LbrQueryMemo()
      const expected = make()
      const first = withLbrQueryMemo(memo, make)
      const second = withLbrQueryMemo(memo, make)
      expect(memo.hits).toBe(1)
      for (const side of [0, 1] as const)
        for (const reach of [Float64Array.of(1, 0), Float64Array.of(0.2, 0.8)]) {
          const answer = new Float64Array(2)
          expected.won(side, reach, answer)
          for (const table of [first, second]) {
            const actual = new Float64Array(2)
            table.won(side, reach, actual)
            expect(actual).toEqual(answer)
            actual.fill(999) // A caller's output is never stored in the memo.
          }
        }
    }
    const memo = new LbrQueryMemo()
    withLbrQueryMemo(memo, () => {
      runoutShowdownTable(rivers.rivers, hands)
      runoutShowdownTable(rivers.rivers.slice(1), hands)
      runoutShowdownTable(rivers.rivers, [hands[1], hands[0]])
    })
    expect(memo.hits).toBe(0)
  })
  it('copies strategies and promise records on both insertion and retrieval', () => {
    const memo = new LbrQueryMemo()
    const network = {}
    let calls = 0
    const solve = () => {
      calls++
      return {
        strategy: new Map([['k', Float64Array.of(0.2, 0.8)]]),
        record: { reach: Float64Array.of(1, 2) },
      }
    }
    const query = () => withLbrQueryMemo(memo, () => memoLbrSolve(network, ['public-state'], solve))
    const first = query()
    first.strategy.get('k')?.fill(0)
    first.record.reach.fill(0)
    const second = query()
    expect(second.strategy.get('k')).toEqual(Float64Array.of(0.2, 0.8))
    expect(second.record.reach).toEqual(Float64Array.of(1, 2))
    second.strategy.clear()
    expect(query().strategy.size).toBe(1)
    expect(calls).toBe(1)
    expect(memo.hits).toBe(2)
  })

  it('separates weights, fixed strategies, model identity and hand scopes; restores scope on errors', () => {
    let calls = 0
    const solve = () => ++calls
    const network = {}
    const memo = new LbrQueryMemo()
    const query = (owner: object, input: unknown) =>
      withLbrQueryMemo(memo, () => memoLbrSolve(owner, input, solve))
    const input = {
      board: [1, 2, 3],
      ranges: [0.2, 0.8],
      fixed: new Map([['k', Float64Array.of(1, 0)]]),
    }
    expect(query(network, input)).toBe(1)
    expect(query(network, structuredClone(input))).toBe(1)
    expect(query(network, { ...input, ranges: [0.8, 0.2] })).toBe(2)
    expect(query(network, { ...input, fixed: new Map([['k', Float64Array.of(0, 1)]]) })).toBe(3)
    expect(query({}, input)).toBe(4)
    expect(withLbrQueryMemo(new LbrQueryMemo(), () => memoLbrSolve(network, input, solve))).toBe(5)
    expect(() =>
      withLbrQueryMemo(memo, () => {
        throw new Error('branch failed')
      }),
    ).toThrow('branch failed')
    // Outside a hypothetical scope even identical live inputs must compute.
    expect(memoLbrSolve(network, input, solve)).toBe(6)
    expect(memoLbrSolve(network, input, solve)).toBe(7)
  })
})
