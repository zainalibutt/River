import { readFileSync } from 'node:fs'
import { type Card, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type TeacherLeaf, teacherShowdown } from './bot-flop-quality.js'
import { solveFlop } from './bot-flop-solver.js'
import { prepare, type RangeCombo, type RiverSpot } from './bot-river-solver.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'
import { actionValues, decisionLoss } from './bot-turn-quality.js'
import {
  bucketInputs,
  bucketsFromRanks,
  holdingValues,
  rangeWeights,
  type ValueNetworkDescription,
  valueNetworkFrom,
} from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
const flop: RiverSpot = {
  board: cards('Ah Kd 7s'),
  pot: 100,
  stack: 400,
  ranges: [
    [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d'), combo('As 2s')],
    [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c'), combo('Th Jh')],
  ],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 1,
}
// The network itself as the teacher: a solve with it should then lose little to its own values.
const selfTeacher: TeacherLeaf = (leaf) => {
  const layout = bucketsFromRanks(expectedStrengthRanks(turnRivers(leaf.board)), network.buckets)
  const [a, b] = holdingValues(
    network,
    layout,
    bucketInputs(layout, rangeWeights(leaf), leaf.stack, leaf.pot),
  )
  return [Float64Array.from(a), Float64Array.from(b)]
}

describe('the flop decision check', () => {
  it('finds a solve close to the best play under its own values, and a coin flip far from it', () => {
    const hands = [
      prepare(flop.ranges[0], flop.board),
      prepare(flop.ranges[1], flop.board),
    ] as const
    const solved = solveFlop(flop, 400, network)
    const scoring = teacherShowdown(solved, hands, selfTeacher, network)
    const at = actionValues(solved, hands, scoring, '')
    expect(at).toBeDefined()
    const width = at?.values.length ?? 1
    const own = decisionLoss(at as NonNullable<typeof at>, solved.strategy.get('') as Float64Array)
    const flat = new Float64Array(hands[0].combos.length * width).fill(1 / width)
    const coin = decisionLoss(at as NonNullable<typeof at>, flat)
    expect(own).toBeGreaterThanOrEqual(0)
    expect(own).toBeLessThan(0.05)
    expect(coin).toBeGreaterThan(own)
  }, 60_000)
})
