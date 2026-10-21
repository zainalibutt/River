import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forwardBatch,
  type RiverValueNetwork,
  type ValueNetworkLayer,
} from './bot-value-network.js'
import { valueNetworkBackend } from './bot-value-simd.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetModules()
})

function randomNetwork(dimensions: number[], seed = 8173): RiverValueNetwork {
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  return {
    buckets: 128,
    layers: dimensions.slice(1).map((rows, i) => {
      const columns = dimensions[i] as number
      return {
        rows,
        columns,
        weight: Float32Array.from(
          { length: rows * columns },
          () => (random() - 0.5) / Math.sqrt(columns),
        ),
        bias: Float32Array.from({ length: rows }, () => random() - 0.5),
        slope: i === dimensions.length - 2 ? null : 0.17,
      }
    }),
  }
}

const buffersFor = (network: RiverValueNetwork, batch: number) =>
  network.layers.map((layer) => new Float32Array(batch * layer.rows))

describe('WASM SIMD value inference', () => {
  it.each([
    [385, 512, 512, 512, 256],
    [641, 512, 512, 512, 256],
    [387, 513, 259],
  ])(
    'matches TS for shape starting with %i, including odd tails and capacity growth',
    (...shape) => {
      const ts = randomNetwork(shape)
      const wasm = { ...ts }
      vi.stubEnv('RIVER_VALUE_BACKEND', 'ts')
      expect(valueNetworkBackend(ts)).toBe('ts')
      vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
      expect(valueNetworkBackend(wasm)).toBe('wasm')
      for (const batch of [1, 4, 44, 48, 49, 5, 67, 3]) {
        const input = Float32Array.from(
          { length: batch * (shape[0] as number) },
          (_, i) => ((i * 37 + batch * 13) % 101) / 25 - 2,
        )
        const tsBuffers = buffersFor(ts, batch)
        const wasmBuffers = buffersFor(wasm, batch)
        for (let visit = 0; visit < 2; visit += 1) {
          input[0] = visit - 0.5
          const expected = forwardBatch(ts, input, batch, tsBuffers)
          const actual = forwardBatch(wasm, input, batch, wasmBuffers)
          expect(actual).toBe(wasmBuffers[wasmBuffers.length - 1])
          let maxDifference = 0
          for (let i = 0; i < actual.length; i += 1) {
            maxDifference = Math.max(
              maxDifference,
              Math.abs((actual[i] as number) - (expected[i] as number)),
            )
          }
          expect(maxDifference).toBeLessThanOrEqual(1e-5)
        }
      }
    },
  )

  it('honors bias, negative slope, linear output and final-row pruning across calls', () => {
    vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
    const network: RiverValueNetwork = {
      buckets: 2,
      layers: [
        {
          rows: 3,
          columns: 5,
          slope: 0.25,
          weight: Float32Array.of(1, 0, 0, 0, 2, -1, 0, 0, 0, -2, 0, 0, 0, 0, 0),
          bias: Float32Array.of(-4, 1, 8),
        },
        {
          rows: 4,
          columns: 3,
          slope: null,
          weight: Float32Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, -1, -1, -1),
          bias: Float32Array.of(1, -2, 3, -4),
        },
      ],
    }
    const batch = 5
    const input = Float32Array.from({ length: batch * 5 }, (_, i) => (i % 5 === 4 ? 1 : 0))
    const buffers = buffersFor(network, batch)
    for (const mask of [Uint8Array.of(1, 0, 1, 0), Uint8Array.of(0, 1, 0, 1), undefined]) {
      buffers[1]?.fill(987)
      const out = forwardBatch(network, input, batch, buffers, mask)
      for (let b = 0; b < batch; b += 1) {
        expect([...(buffers[0] as Float32Array).subarray(b * 3, b * 3 + 3)]).toEqual([
          -0.5, -0.25, 8,
        ])
        const expected = [0.5, -2.25, 11, -11.25]
        for (let r = 0; r < 4; r += 1) {
          expect(out[b * 4 + r]).toBe(mask?.[r] === 0 ? 987 : expected[r])
        }
      }
    }
  })

  it('copies weights once and uses the TS path when forced, with selection fixed per network', () => {
    const ts = randomNetwork([5, 3])
    const wasm = { ...ts }
    vi.stubEnv('RIVER_VALUE_BACKEND', 'ts')
    expect(valueNetworkBackend(ts)).toBe('ts')
    vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
    expect(valueNetworkBackend(wasm)).toBe('wasm')
    const input = new Float32Array(5).fill(1)
    const a = buffersFor(ts, 1)
    const b = buffersFor(wasm, 1)
    const before = forwardBatch(wasm, input, 1, b).slice()
    // Deliberately violate immutability to distinguish copied WASM weights from TS.
    ;(ts.layers[0] as ValueNetworkLayer).weight.fill(2)
    ;(ts.layers[0] as ValueNetworkLayer).bias.fill(3)
    expect([...forwardBatch(ts, input, 1, a)]).toEqual([13, 13, 13])
    expect(forwardBatch(wasm, input, 1, b)).toEqual(before)
    expect(valueNetworkBackend(ts)).toBe('ts')
  })

  it('does not construct float buffers or grow WASM memory on warmed calls', () => {
    vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
    const network = randomNetwork([385, 512, 256])
    const input = new Float32Array(49 * 385).fill(0.5)
    const buffers = buffersFor(network, 49)
    forwardBatch(network, input, 49, buffers)
    const grow = vi.spyOn(WebAssembly.Memory.prototype, 'grow')
    let allocations = 0
    vi.stubGlobal(
      'Float32Array',
      new Proxy(Float32Array, {
        construct(target, args) {
          allocations += 1
          return Reflect.construct(target, args)
        },
      }),
    )
    for (let visit = 0; visit < 3; visit += 1) forwardBatch(network, input, 49, buffers)
    expect(allocations).toBe(0)
    expect(grow).not.toHaveBeenCalled()
  })

  it('defaults to WASM when supported and falls back when WebAssembly is absent', async () => {
    vi.stubEnv('RIVER_VALUE_BACKEND', undefined)
    expect(valueNetworkBackend(randomNetwork([5, 3]))).toBe('wasm')
    vi.resetModules()
    vi.stubGlobal('WebAssembly', undefined)
    const fallback = await import('./bot-value-network.js')
    const diagnostic = await import('./bot-value-simd.js')
    const network = randomNetwork([5, 3])
    expect(diagnostic.valueNetworkBackend(network)).toBe('ts')
    const input = new Float32Array(5).fill(1)
    expect(fallback.forwardBatch(network, input, 1, buffersFor(network, 1))).toEqual(
      fallback.forward(network, input),
    )
    vi.stubEnv('RIVER_VALUE_BACKEND', 'wasm')
    expect(() => diagnostic.valueNetworkBackend({ ...network })).toThrow('unavailable')
  })
})
