import type { RiverValueNetwork, ValueNetworkLayer } from './bot-value-network.js'
import { VALUE_SIMD_BASE64 } from './bot-value-simd-bytes.js'
import {
  requestedValueThreads,
  ValueWorkerPool,
  valueWorkerFinalizer,
} from './bot-value-workers.js'

interface Kernel {
  memory: WebAssembly.Memory
  dense: (
    input: number,
    weight: number,
    bias: number,
    output: number,
    rows: number,
    columns: number,
    batch: number,
    slope: number,
    mask: number,
  ) => void
}

let compiled: WebAssembly.Module | null | undefined
function module(): WebAssembly.Module | null {
  if (compiled === undefined) {
    try {
      compiled = new WebAssembly.Module(Buffer.from(VALUE_SIMD_BASE64, 'base64'))
    } catch {
      compiled = null // Unsupported SIMD or a runtime that disallows WASM.
    }
  }
  return compiled
}

/**
 * Private memory and copied, immutable weights per network. Single-threaded,
 * synchronous use only: scratch buffers make this backend non-reentrant.
 * Capacity grows only on a new batch high-water mark; steady calls allocate
 * no JS buffers/views or WASM memory. GC releases memory with the network.
 */
class SimdNetwork {
  private readonly kernel: Kernel
  private readonly weights: number[] = []
  private readonly biases: number[] = []
  private readonly scratch: number
  private capacity = 0
  private input!: Float32Array
  private mask!: Uint8Array
  private outputs: Float32Array[] = []

  constructor(
    private readonly network: RiverValueNetwork,
    wasm: WebAssembly.Module,
  ) {
    this.kernel = new WebAssembly.Instance(wasm).exports as unknown as Kernel
    let bytes = 16 // Reserve address zero for the no-mask sentinel.
    for (const layer of network.layers) {
      this.weights.push(bytes)
      bytes += layer.weight.byteLength
      this.biases.push(bytes)
      bytes += layer.bias.byteLength
    }
    this.scratch = Math.ceil(bytes / 16) * 16
    this.reserve(64)
    for (let i = 0; i < network.layers.length; i += 1) {
      const layer = network.layers[i] as ValueNetworkLayer
      new Float32Array(this.kernel.memory.buffer, this.weights[i], layer.weight.length).set(
        layer.weight,
      )
      new Float32Array(this.kernel.memory.buffer, this.biases[i], layer.bias.length).set(layer.bias)
    }
  }

  private reserve(batch: number): void {
    if (batch <= this.capacity) return
    this.capacity = Math.max(64, batch, this.capacity * 2)
    const layers = this.network.layers
    const columns = (layers[0] as ValueNetworkLayer).columns
    const lastRows = (layers[layers.length - 1] as ValueNetworkLayer).rows
    const floats = this.capacity * (columns + layers.reduce((sum, l) => sum + l.rows, 0))
    const bytes = this.scratch + floats * 4 + lastRows
    const memory = this.kernel.memory
    const pages = Math.ceil(bytes / 65536) - memory.buffer.byteLength / 65536
    if (pages > 0) memory.grow(pages)
    let at = this.scratch
    this.input = new Float32Array(memory.buffer, at, this.capacity * columns)
    at += this.input.byteLength
    this.outputs = layers.map((layer) => {
      const view = new Float32Array(memory.buffer, at, this.capacity * layer.rows)
      at += view.byteLength
      return view
    })
    this.mask = new Uint8Array(memory.buffer, at, lastRows)
  }

  forward(
    input: Float32Array,
    batch: number,
    buffers: readonly Float32Array[],
    outputRows?: Uint8Array,
  ): Float32Array {
    this.reserve(batch)
    this.input.set(input)
    // The API skips only explicitly zero mask entries, including short masks.
    for (let r = 0; r < this.mask.length; r += 1) this.mask[r] = outputRows?.[r] === 0 ? 0 : 1
    let current = this.input
    for (let i = 0; i < this.network.layers.length; i += 1) {
      const layer = this.network.layers[i] as ValueNetworkLayer
      const out = this.outputs[i] as Float32Array
      const last = i === this.network.layers.length - 1
      this.kernel.dense(
        current.byteOffset,
        this.weights[i] as number,
        this.biases[i] as number,
        out.byteOffset,
        layer.rows,
        layer.columns,
        batch,
        layer.slope ?? 1,
        last ? this.mask.byteOffset : 0,
      )
      const target = buffers[i] as Float32Array
      for (let b = 0; b < batch; b += 1) {
        for (let r = 0; r < layer.rows; r += 1) {
          if (last && this.mask[r] === 0) continue
          const at = b * layer.rows + r
          target[at] = out[at] as number
        }
      }
      current = out
    }
    return buffers[this.network.layers.length - 1] as Float32Array
  }
}

const backends = new WeakMap<RiverValueNetwork, SimdNetwork | null>()
const pools = new WeakMap<RiverValueNetwork, ValueWorkerPool | null>()

/** Actual active participants after the first batch; TS fallback always uses one. */
export function valueNetworkThreads(network: RiverValueNetwork): number {
  return pools.get(network)?.threads ?? 1
}

/** Explicit shutdown for owners that unload models, and bounded test cleanup. */
export function closeValueNetworkWorkers(network: RiverValueNetwork): void {
  pools.get(network)?.close()
  pools.set(network, null)
  valueWorkerFinalizer.unregister(network)
}

/** Selection is fixed at first use; forced WASM fails visibly if unavailable. */
function backend(network: RiverValueNetwork): SimdNetwork | null {
  const known = backends.get(network)
  if (known !== undefined) return known
  const choice = process.env.RIVER_VALUE_BACKEND
  if (choice !== undefined && choice !== 'ts' && choice !== 'wasm') {
    throw new Error('RIVER_VALUE_BACKEND must be ts or wasm')
  }
  let selected: SimdNetwork | null = null
  if (choice !== 'ts') {
    try {
      const wasm = module()
      if (wasm !== null) selected = new SimdNetwork(network, wasm)
    } catch (error) {
      if (choice === 'wasm') throw error
    }
    if (selected === null && choice === 'wasm') throw new Error('WASM SIMD is unavailable')
  }
  backends.set(network, selected)
  return selected
}

/** Also useful for diagnostics: reports the backend actually selected. */
export function valueNetworkBackend(network: RiverValueNetwork): 'ts' | 'wasm' {
  return backend(network) === null ? 'ts' : 'wasm'
}

export function simdForwardBatch(
  network: RiverValueNetwork,
  input: Float32Array,
  batch: number,
  buffers: readonly Float32Array[],
  outputRows?: Uint8Array,
): Float32Array | undefined {
  const selected = backend(network)
  if (selected === null) return undefined
  let pool = pools.get(network)
  if (pool === undefined) {
    pool = null
    const threads = requestedValueThreads()
    if (threads > 1) {
      try {
        pool = new ValueWorkerPool(network, module() as WebAssembly.Module, threads)
        valueWorkerFinalizer.register(network, pool, network)
      } catch {
        // Workers are optional, including in runtimes that prohibit their startup.
      }
    }
    pools.set(network, pool)
  }
  const parallel = pool?.forward(network, input, batch, buffers, outputRows, (...args) =>
    selected.forward(...args),
  )
  return parallel ?? selected.forward(input, batch, buffers, outputRows)
}
