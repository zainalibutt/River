import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RIVER_DATA_SETTINGS, sampleRiverSpot } from './bot-river-value-data.js'
import {
  forward,
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
