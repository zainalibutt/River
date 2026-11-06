import { type Card, parseCard } from '@river/engine'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type RangeCombo,
  type RiverSolution,
  type RiverSpot,
  setSolveDeadline,
  solveRiver,
  takeBelowFloorSolves,
  takeShortenedSolves,
} from './bot-river-solver.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string): RangeCombo => ({ hole: cards(text) as [Card, Card], weight: 1 })
const spot: RiverSpot = {
  board: cards('Ah Kd 7s 4c 2h'),
  pot: 100,
  stack: 1000,
  ranges: [[combo('8s 8h')], [combo('7c 7d'), combo('7h 7d'), combo('5c 6d'), combo('5d 6c')]],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 1,
}
const gadget = { player: 1 as const, promises: new Float64Array(4).fill(40) }

function solve(iterations: number, withGadget = false) {
  return solveRiver(
    spot,
    iterations,
    undefined,
    undefined,
    withGadget ? gadget : undefined,
    undefined,
    {
      scheme: 'dcfr',
      captureState: true,
    },
  )
}

function tables(solution: RiverSolution) {
  return [...solution.strategy].map(([history, table]) => [history, [...table]] as const)
}

afterEach(() => {
  setSolveDeadline(undefined)
  takeShortenedSolves()
  takeBelowFloorSolves()
})

describe('solve deadline', () => {
  it.each([false, true])(
    'past the deadline stops at the floor, as that many iterations would (gadget %s)',
    (withGadget) => {
      setSolveDeadline(performance.now() - 1, 0.5)
      const cut = solve(80, withGadget)
      expect(takeShortenedSolves()).toBe(1)
      setSolveDeadline(undefined)
      const half = solve(40, withGadget)

      expect(cut.cfrState?.iterations).toBe(40)
      expect(tables(cut)).toEqual(tables(half))
      expect(cut.followShare && [...cut.followShare]).toEqual(
        half.followShare && [...half.followShare],
      )
    },
  )

  it('leaves a solve alone before the deadline and without one', () => {
    const full = solve(80)
    setSolveDeadline(performance.now() + 60_000, 0.5)
    const early = solve(80)

    expect(early.cfrState?.iterations).toBe(80)
    expect(tables(early)).toEqual(tables(full))
    expect(takeShortenedSolves()).toBe(0)
  })

  it('never cuts a solve whose floor is all of it', () => {
    setSolveDeadline(performance.now() - 1, 1)
    expect(solve(40).cfrState?.iterations).toBe(40)
    expect(takeShortenedSolves()).toBe(0)
  })

  it('refuses a floor outside (0, 1]', () => {
    expect(() => setSolveDeadline(0, 0)).toThrow('floor')
    expect(() => setSolveDeadline(Number.NaN)).toThrow('finite')
  })
})

describe('hard stop', () => {
  it('stops below the floor once the hard stop has passed, and counts it', () => {
    setSolveDeadline(performance.now() - 2, 0.5, performance.now() - 1)
    const cut = solve(80)
    expect(cut.cfrState?.iterations).toBe(1)
    expect(takeShortenedSolves()).toBe(1)
    expect(takeBelowFloorSolves()).toBe(1)
    setSolveDeadline(undefined)
    expect(tables(cut)).toEqual(tables(solve(1)))
  })

  it('cuts a 1x solve only at the hard stop', () => {
    const now = performance.now()
    setSolveDeadline(now - 1, 1, now + 60_000)
    expect(solve(40).cfrState?.iterations).toBe(40)
    setSolveDeadline(now - 1, 1, now - 1)
    expect(solve(40).cfrState?.iterations).toBe(1)
    expect(takeBelowFloorSolves()).toBe(1)
  })

  it('refuses a hard stop before the soft deadline', () => {
    expect(() => setSolveDeadline(10, 0.5, 5)).toThrow('later hard stop')
  })
})
