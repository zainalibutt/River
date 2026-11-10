import { type Card, parseCard } from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { perTurnShowdown } from './bot-flop-turn-leaves.js'
import {
  addRiverAction,
  prepare,
  type RiverSpot,
  riverValues,
  solveRiver,
} from './bot-river-solver.js'
import { createPromiseRecord, perRiverShowdown } from './bot-turn-river-leaves.js'
import * as tables from './bot-turn-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'
import * as inference from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const held = (text: string, weight: number) => ({ hole: cards(text) as [Card, Card], weight })
const network: RiverValueNetwork = {
  buckets: 2,
  layers: [
    {
      rows: 4,
      columns: 7,
      slope: null,
      weight: Float32Array.from({ length: 28 }, (_, i) => (i % 5) * 0.01),
      bias: Float32Array.of(0.2, 0.4, 0.6, 0.8),
    },
  ],
}
afterEach(() => vi.restoreAllMocks())

it('reuses only identical network inputs while recomputing masses and recording every sample', {
  timeout: 60_000,
}, () => {
  const spot: RiverSpot = {
    board: cards('Ah Kd 7s 4c'),
    pot: 100,
    stack: 300,
    ranges: [
      [held('Ac Qc', 2), held('8h 8d', 0.5)],
      [held('As Qd', 3), held('Kc Qc', 1)],
    ],
    betSizes: [0.3],
    allIn: true,
    maxRaises: 0,
  }
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const node = { kind: 'showdown' as const, paid: [30, 30] as const }
  const calls = vi.spyOn(inference, 'forwardBatch')
  const first = createPromiseRecord()
  const prepared = perRiverShowdown(spot, network, first)
  const query = (showdown: typeof prepared, reaches: readonly [Float64Array, Float64Array]) =>
    ([0, 1] as const).map((player) => {
      const out = new Float64Array(hands[player].combos.length)
      showdown(node, player, hands, reaches[player], reaches[player === 0 ? 1 : 0], out, {
        history: 'b30c',
        weight: 3,
        discount: 0.75,
      })
      return out
    })
  const reaches = [hands[0].weights, hands[1].weights] as const
  const firstValues = query(prepared, reaches)
  expect(calls).toHaveBeenCalledTimes(2)
  const snapshot = structuredClone(first)
  const nextRecord = createPromiseRecord()
  const reused = prepared.withRecord(nextRecord)
  const scaled = reaches.map((r) => Float64Array.from(r, (v) => 2 * v)) as [
    Float64Array,
    Float64Array,
  ]
  const scaledValues = query(reused, scaled)
  expect(calls).toHaveBeenCalledTimes(2)
  expect(scaledValues).toEqual(firstValues.map((r) => Float64Array.from(r, (v) => 2 * v)))
  const changed = [Float64Array.of(0, 1), Float64Array.of(1, 0)] as const
  const changedValues = query(reused, changed)
  expect(calls).toHaveBeenCalledTimes(4)
  const coldRecord = createPromiseRecord()
  const cold = perRiverShowdown(spot, network, coldRecord)
  query(cold, scaled)
  expect(query(cold, changed)).toEqual(changedValues)
  expect(nextRecord).toEqual(coldRecord)
  expect(nextRecord.leaves.get('b30c')?.weight).toEqual([5.25, 5.25])
  expect(first).toEqual(snapshot)
  const zero = [new Float64Array(2), new Float64Array(2)] as const
  const oldPathRecord = structuredClone(nextRecord)
  const count = calls.mock.calls.length
  const zeros = query(reused, zero)
  expect(calls).toHaveBeenCalledTimes(count)
  expect(zeros).toEqual([new Float64Array(2), new Float64Array(2)])
  // Function evaluators deliberately retain the full integration path. With
  // zero opponent mass any finite prediction must give the same zero CFVs,
  // record discounts and sample weights as the optimized network path.
  const oldPath = perRiverShowdown(
    spot,
    () => [new Float64Array(1326).fill(0.5), new Float64Array(1326).fill(0.5)],
    oldPathRecord,
  )
  expect(query(oldPath, zero)).toEqual(zeros)
  expect(nextRecord).toEqual(oldPathRecord)
})

describe.each(['cfr+', 'dcfr'] as const)('%s shared leaf preparation', (scheme) => {
  it.each([3, 4])(
    'matches cold solves and independent records on a %i-card board',
    (length) => {
      const spot: RiverSpot = {
        board: cards('Ah Kd 7s 4c').slice(0, length),
        pot: 100,
        stack: 80,
        ranges: [
          [held('Ac Qc', 2), held('8h 8d', 0.5)],
          [held('As Qd', 3), held('Kc Qc', 1)],
        ],
        betSizes: [0.3],
        allIn: true,
        maxRaises: 0,
      }
      const make = length === 3 ? perTurnShowdown : perRiverShowdown
      const table = vi.spyOn(tables, length === 3 ? 'allInFromTable' : 'allInShowdown')
      const firstRecord = createPromiseRecord()
      const prepared = make(spot, network, firstRecord)
      const initial = solveRiver(spot, 8, undefined, prepared, undefined, undefined, { scheme })
      expect(table).toHaveBeenCalledTimes(1)
      const snapshot = structuredClone(firstRecord)
      const flat: RiverSpot = {
        ...spot,
        ranges: [spot.ranges[0], spot.ranges[1].map((h) => ({ ...h, weight: 1 }))],
      }
      const gadget = { player: 1 as const, promises: riverValues(initial).values[1] }
      const tree = addRiverAction(flat, initial.tree, 'b30', 70)
      const fixedStrategies = new Map([['', initial.strategy.get('') as Float64Array]])
      const reusedRecord = createPromiseRecord()
      const reused = solveRiver(
        flat,
        8,
        undefined,
        prepared.withRecord(reusedRecord),
        gadget,
        tree,
        {
          scheme,
          fixedStrategies,
        },
      )
      expect(table).toHaveBeenCalledTimes(1)
      const coldRecord = createPromiseRecord()
      const cold = solveRiver(flat, 8, undefined, make(flat, network, coldRecord), gadget, tree, {
        scheme,
        fixedStrategies,
      })
      expect(table).toHaveBeenCalledTimes(2)
      expect(reused.strategy).toEqual(cold.strategy)
      expect(reused.followShare).toEqual(cold.followShare)
      expect(reusedRecord).toEqual(coldRecord)
      expect(riverValues(reused)).toEqual(riverValues(cold))
      expect(firstRecord).toEqual(snapshot)
      // Old solutions still query their own weights and never append samples.
      const values = riverValues(initial)
      const fresh = solveRiver(spot, 8, undefined, make(spot, network), undefined, undefined, {
        scheme,
      })
      expect(values).toEqual(riverValues(fresh))
      expect(firstRecord).toEqual(snapshot)
      const permuted: RiverSpot = {
        ...flat,
        ranges: [[...flat.ranges[0]].reverse(), flat.ranges[1]],
      }
      expect(() => solveRiver(permuted, 1, undefined, prepared.withRecord())).toThrow(
        'per-card preparation holding order changed',
      )
    },
    30_000,
  )
})
