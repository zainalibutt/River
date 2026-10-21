import { type Card, parseCard } from '@river/engine'
import { expect, it } from 'vitest'
import { iterationStudyCli, parseArgs, summarize } from './bot-iteration-study.js'
import type { RiverSpot } from './bot-river-solver.js'
import { COMBOS } from './bot-river-value-data.js'

it('runs the CLI report on a tiny turn game and reduces exploitability with more CFR', () => {
  const hole = (text: string) => text.split(' ').map(parseCard) as [Card, Card]
  const spot: RiverSpot = {
    board: 'Ah Kd 7s 4c'.split(' ').map(parseCard),
    pot: 100,
    stack: 300,
    ranges: [
      ['Ac Qc', '8h 8d', '5c 6c'].map((s) => ({ hole: hole(s), weight: 1 })),
      ['As Qd', 'Kc Qc', '6h 5h'].map((s) => ({ hole: hole(s), weight: 1 })),
    ],
    betSizes: [0.3],
    allIn: false,
    maxRaises: 0,
  }
  const seeds: string[] = []
  let json = ''
  iterationStudyCli(['tiny', 'test', '1', '1'], {
    load: () => () => [new Float64Array(COMBOS).fill(0.5), new Float64Array(COMBOS).fill(0.5)],
    sample: (seed) => {
      seeds.push(seed)
      return spot
    },
    output: (text) => {
      json = text
    },
    progress: () => {},
  })
  const report = JSON.parse(json)
  expect(seeds).toEqual(['test:0:0'])
  expect(report.schemaVersion).toBe(1)
  expect(report.referenceIterations).toBe(400)
  expect(report.byK.map((r: { k: number }) => r.k)).toEqual([1, 400])
  const [small, large] = report.byK
  expect(large.exploitabilityPctPot.mean).toBeLessThan(small.exploitabilityPctPot.mean)
  expect(large.cfvMaePots.map((v: { mean: number }) => v.mean)).toEqual([0, 0])
  expect(large.rootTv.mean).toBe(0)
  expect(large.promiseMaePots.map((v: { mean: number }) => v.mean)).toEqual([0, 0])
  expect(small.solveMs.mean).toBeGreaterThan(0)
  expect(small.exploitabilityPctPot.ci95).toBeNull()
  expect(report.spots[0].riverCards).toHaveLength(3)
  expect(report.spots[0].runs[0].comparedPromises).toBeGreaterThan(0)
})

it('validates counts, adds a 400 reference, and reports spot-level uncertainty', () => {
  expect(parseArgs(['model', 'seed']).iterations).toEqual([25, 40, 50, 100, 400])
  expect(() => parseArgs(['model', 'seed', '0'])).toThrow('usage')
  expect(() => parseArgs(['model', 'seed', '1', 'NaN'])).toThrow('usage')
  expect(summarize([])).toEqual({ n: 0, mean: null, ci95: null })
  expect(summarize([1, 2, 3]).mean).toBe(2)
  expect(summarize([1, 2, 3]).ci95?.[0]).toBeLessThan(1)
})
