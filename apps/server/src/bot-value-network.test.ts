import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COMBOS, RIVER_DATA_SETTINGS, sampleRiverSpot } from './bot-river-value-data.js'
import {
  bucketInputs,
  bucketsFromIds,
  forward,
  holdingValues,
  type RiverValueNetwork,
  riverBucketInputs,
  riverHoldingValues,
  type ValueNetworkDescription,
  valueNetworkFrom,
} from './bot-value-network.js'

/**
 * A tiny network with random weights and three spots, with the inputs and
 * outputs PyTorch computed for them (ml/export_value_parity.py). The server's
 * maths must match, or the network it plays with is not the one that trained.
 */
interface Fixture extends ValueNetworkDescription {
  readonly weights: readonly number[]
  readonly cases: readonly {
    readonly seed: string
    readonly inputs: readonly number[]
    readonly outputs: readonly number[]
  }[]
}

const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as Fixture
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))

describe('the value network in the server', () => {
  it('builds the inputs training built, from the spot alone', () => {
    expect(fixture.cases.length).toBeGreaterThan(0)
    for (const example of fixture.cases) {
      const spot = sampleRiverSpot(example.seed, RIVER_DATA_SETTINGS)
      const { inputs } = riverBucketInputs(spot, fixture.buckets)
      expect(inputs).toHaveLength(example.inputs.length)
      example.inputs.forEach((value, index) => {
        expect(inputs[index]).toBeCloseTo(value, 4)
      })
    }
  })

  it('computes what PyTorch computes', () => {
    for (const example of fixture.cases) {
      const out = forward(network, Float32Array.from(example.inputs))
      expect(out).toHaveLength(example.outputs.length)
      example.outputs.forEach((value, index) => {
        expect(out[index]).toBeCloseTo(value, 4)
      })
    }
  })

  it("gives each holding its bucket's value, and nothing where the board blocks it", () => {
    const example = fixture.cases[0]
    if (example === undefined) throw new Error('no parity cases')
    const spot = sampleRiverSpot(example.seed, RIVER_DATA_SETTINGS)
    const { inputs, bucketOf } = riverBucketInputs(spot, fixture.buckets)
    const out = forward(network, inputs)
    const values = riverHoldingValues(network, spot)
    bucketOf.forEach((bucket, index) => {
      if (bucket < 0) {
        expect(values[0][index]).toBe(0)
        expect(values[1][index]).toBe(0)
      } else {
        expect(values[0][index]).toBe(out[bucket])
        expect(values[1][index]).toBe(out[fixture.buckets + bucket])
      }
    })
  })
})

describe('a network that learns what betting adds', () => {
  // Two buckets: holdings 0 and 1 in the first, holding 2 in the second.
  const ids = new Uint8Array(COMBOS).fill(255)
  ids[0] = 0
  ids[1] = 0
  ids[2] = 1
  const layout = bucketsFromIds(ids, 2)
  const checked = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  checked[0].set([0.2, 0.4, 0.9])
  checked[1].set([0.8, 0.6, 0.1])
  const ranges = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  ranges[0].set([1, 1, 2])
  ranges[1].set([1, 0, 1])

  it("sees each bucket's mean checked-down value after the usual inputs", () => {
    const inputs = bucketInputs(layout, ranges, 300, 100, checked)
    expect(inputs).toHaveLength(5 * 2 + 1)
    expect([...inputs.subarray(0, 7)]).toEqual([...bucketInputs(layout, ranges, 300, 100)])
    expect(inputs[7]).toBeCloseTo(0.3, 6)
    expect(inputs[8]).toBeCloseTo(0.9, 6)
    expect(inputs[9]).toBeCloseTo(0.7, 6)
    expect(inputs[10]).toBeCloseTo(0.1, 6)
  })

  it('weighs those means by the range when asked, nought where the range has none', () => {
    const inputs = bucketInputs(layout, ranges, 300, 100, checked, 'range')
    expect(inputs).toHaveLength(5 * 2 + 1)
    expect(inputs[7]).toBeCloseTo(0.3, 6)
    expect(inputs[8]).toBeCloseTo(0.9, 6)
    expect(inputs[9]).toBeCloseTo(0.8, 6)
    expect(inputs[10]).toBeCloseTo(0.1, 6)
    const empty = [new Float64Array(COMBOS), ranges[1]] as const
    expect(bucketInputs(layout, empty, 300, 100, checked, 'range')[7]).toBe(0)
  })

  it('adds each holding its own checked-down value, and refuses to run without one', () => {
    // One layer: bucket outputs 0.05 and -0.05 for the first player, 0 and 0.1 for the second.
    const network: RiverValueNetwork = {
      buckets: 2,
      layers: [
        {
          weight: new Float32Array(4 * 7),
          bias: Float32Array.from([0.05, -0.05, 0, 0.1]),
          rows: 4,
          columns: 7,
          slope: null,
        },
      ],
      checked: { inputs: false },
    }
    const inputs = bucketInputs(layout, ranges, 300, 100)
    expect(() => holdingValues(network, layout, inputs)).toThrow()
    const values = holdingValues(network, layout, inputs, checked)
    expect([...values[0].subarray(0, 3)].map((v) => Number(v.toFixed(6)))).toEqual([
      0.25, 0.45, 0.85,
    ])
    expect([...values[1].subarray(0, 3)].map((v) => Number(v.toFixed(6)))).toEqual([0.8, 0.6, 0.2])
  })
})
