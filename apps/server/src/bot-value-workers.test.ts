import { Worker } from 'node:worker_threads'
import { type Card, cardKey, parseCard } from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepare, type RiverSpot } from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import {
  carriedRiverPromises,
  createRiverPromiseRecord,
  perRiverShowdown,
} from './bot-turn-river-leaves.js'
import { forwardBatch, type RiverValueNetwork } from './bot-value-network.js'
import {
  closeValueNetworkWorkers,
  valueNetworkBackend,
  valueNetworkThreads,
} from './bot-value-simd.js'

const networks: RiverValueNetwork[] = []
afterEach(() => {
  for (const network of networks) closeValueNetworkWorkers(network)
  networks.length = 0
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function randomNetwork(shape: number[], seed: number): RiverValueNetwork {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const network: RiverValueNetwork = {
    buckets: 128,
    layers: shape.slice(1).map((rows, i) => ({
      rows,
      columns: shape[i] as number,
      weight: Float32Array.from(
        { length: rows * (shape[i] as number) },
        () => (random() - 0.5) / Math.sqrt(shape[i] as number),
      ),
      bias: Float32Array.from({ length: rows }, () => random() - 0.5),
      slope: i === shape.length - 2 ? null : 0.17,
    })),
  }
  networks.push(network)
  return network
}

const buffersFor = (network: RiverValueNetwork, batch: number) =>
  network.layers.map((layer) => new Float32Array(batch * layer.rows).fill(987))
const bits = (values: Float32Array) =>
  new Uint32Array(values.buffer, values.byteOffset, values.length)

describe('synchronous row-partitioned inference', () => {
  it.each([
    [2, [385, 512, 512, 512, 256], 8173],
    [4, [641, 512, 512, 512, 256], 9021],
    [4, [387, 513, 259], 1701],
  ] as const)(
    '%i participants are bit-identical at every layer, with masks, tails and growth',
    (threads, shape, seed) => {
      const serial = randomNetwork([...shape], seed)
      const parallel = { ...serial }
      networks.push(parallel)
      vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
      vi.stubEnv('RIVER_VALUE_THREADS', '1')
      // Backend/thread selection is fixed by the first batch, independently per model.
      forwardBatch(serial, new Float32Array(shape[0]), 1, buffersFor(serial, 1))
      vi.stubEnv('RIVER_VALUE_THREADS', String(threads))
      let state = seed
      for (const batch of [49, 0, 1, 2, 3, 4, 48, 5, 67, 7]) {
        const input = Float32Array.from({ length: batch * shape[0] }, () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0
          return state / 1073741824 - 2
        })
        const a = buffersFor(serial, batch)
        const b = buffersFor(parallel, batch)
        // Include short and changing masks; missing entries mean compute.
        for (const mask of [Uint8Array.of(1, 0, 1, 0), Uint8Array.of(0, 1), undefined]) {
          for (const out of a) out.fill(987)
          for (const out of b) out.fill(987)
          forwardBatch(serial, input, batch, a, mask)
          expect(forwardBatch(parallel, input, batch, b, mask)).toBe(b.at(-1))
          expect(valueNetworkThreads(parallel)).toBe(threads)
          expect(valueNetworkThreads(serial)).toBe(1)
          for (let i = 0; i < a.length; i += 1) {
            expect(bits(b[i] as Float32Array)).toEqual(bits(a[i] as Float32Array))
          }
        }
      }
    },
    30_000,
  )

  it('falls back permanently if worker construction is prohibited', () => {
    vi.stubEnv('RIVER_VALUE_THREADS', '2')
    const network = randomNetwork([7, 5, 4], 731)
    // structuredClone is performed by Worker before startup; a function cannot
    // cross that boundary. The numerical network is otherwise valid.
    Object.assign(network, { uncloneable: () => 0 })
    const input = new Float32Array(7 * 9).fill(0.5)
    const expected = buffersFor(network, 9)
    const actual = buffersFor(network, 9)
    vi.stubEnv('RIVER_VALUE_THREADS', '1')
    const serial = { ...network }
    networks.push(serial)
    forwardBatch(serial, input, 9, expected)
    vi.stubEnv('RIVER_VALUE_THREADS', '2')
    forwardBatch(network, input, 9, actual)
    expect(valueNetworkThreads(network)).toBe(1)
    expect(actual).toEqual(expected)
  })

  it('discards failed worker output and recomputes every row synchronously', () => {
    vi.stubEnv('RIVER_VALUE_THREADS', '2')
    const network = randomNetwork([7, 5, 4], 321)
    const input = new Float32Array(7 * 9).fill(-0.5)
    const actual = buffersFor(network, 9)
    forwardBatch(network, input, 9, actual)
    expect(valueNetworkThreads(network)).toBe(2)
    const post = Worker.prototype.postMessage
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message) {
      post.call(this, { ...message, sharedInput: new SharedArrayBuffer(0) })
    })
    input.fill(0.75)
    forwardBatch(network, input, 9, actual)
    expect(valueNetworkThreads(network)).toBe(1)
    const serial = { ...network }
    networks.push(serial)
    vi.stubEnv('RIVER_VALUE_THREADS', '1')
    const expected = buffersFor(serial, 9)
    forwardBatch(serial, input, 9, expected)
    expect(actual).toEqual(expected)
  })

  it('keeps forced TS single-threaded', () => {
    vi.stubEnv('RIVER_VALUE_BACKEND', 'ts')
    vi.stubEnv('RIVER_VALUE_THREADS', '4')
    const network = randomNetwork([7, 4], 35)
    forwardBatch(network, new Float32Array(7 * 3), 3, buffersFor(network, 3))
    expect(valueNetworkBackend(network)).toBe('ts')
    expect(valueNetworkThreads(network)).toBe(1)
  })

  it('bounds a missing completion signal and permanently falls back', () => {
    vi.stubEnv('RIVER_VALUE_THREADS', '2')
    const network = randomNetwork([7, 5, 4], 940)
    const input = new Float32Array(7 * 9).fill(0.5)
    const expected = buffersFor(network, 9)
    forwardBatch(network, input, 9, expected)
    expect(valueNetworkThreads(network)).toBe(2)
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(30_001)
    const actual = buffersFor(network, 9)
    forwardBatch(network, input, 9, actual)
    expect(valueNetworkThreads(network)).toBe(1)
    expect(actual).toEqual(expected)
  })

  it('passes an independent paid-chip, compatible-mass carried-promise oracle threaded', () => {
    vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
    vi.stubEnv('RIVER_VALUE_THREADS', '2')
    const held = (s: string, weight: number) => ({
      hole: s.split(' ').map(parseCard) as [Card, Card],
      weight,
    })
    const spot: RiverSpot = {
      board: 'Ah Kd 7s 4c'.split(' ').map(parseCard),
      pot: 100,
      stack: 300,
      ranges: [
        [held('Ac Qc', 2), held('8h 8d', 0.5), held('2d 3d', 7)],
        [held('As Qd', 3), held('Ac Jc', 1)],
      ],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const network: RiverValueNetwork = {
      buckets: 2,
      layers: [
        {
          columns: 7,
          rows: 4,
          weight: new Float32Array(28),
          bias: Float32Array.of(0.25, 0.25, 0.75, 0.75),
          slope: null,
        },
      ],
    }
    networks.push(network)
    const record = createRiverPromiseRecord()
    const hook = perRiverShowdown(spot, network, record)
    const hands = [
      prepare(spot.ranges[0], spot.board),
      prepare(spot.ranges[1], spot.board),
    ] as const
    // Independently weight two visits; DCFR discount 1/2 scales the old sample.
    for (const [weight, discount] of [
      [2, 1],
      [3, 0.5],
    ]) {
      for (const player of [0, 1] as const) {
        hook(
          { kind: 'showdown', paid: [30, 30] },
          player,
          hands,
          hands[player].weights,
          hands[player === 0 ? 1 : 0].weights,
          new Float64Array(hands[player].combos.length),
          { history: 'b30c', weight: weight as number, discount: discount as number },
        )
      }
    }
    expect(valueNetworkThreads(network)).toBe(2)
    for (const player of [0, 1] as const) {
      const carried = carriedRiverPromises(record, 'b30c', cardKey(parseCard('2d')), player)
      for (const opponent of spot.ranges[player === 0 ? 1 : 0]) {
        const index = comboIndex52(...(opponent.hole.map(cardKey) as [number, number]))
        let mass = 0
        for (const own of spot.ranges[player]) {
          const keys = [...own.hole, ...opponent.hole].map(cardKey)
          if (!keys.includes(cardKey(parseCard('2d'))) && new Set(keys).size === 4)
            mass += own.weight
        }
        expect(carried.masses[index]).toBe(mass)
        if (mass > 0) {
          const value = player === 0 ? 0.75 : 0.25
          expect(carried.cfvs[index]).toBe(mass * (160 * value - 30))
          expect(carried.promises[index]).toBe(value)
        } else expect(carried.zeroMass[index]).toBe(1)
      }
    }
  })
})
