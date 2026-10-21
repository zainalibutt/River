import { Worker } from 'node:worker_threads'
import type { RiverValueNetwork } from './bot-value-network.js'

// An inline CommonJS entry point works in emitted Node, tsx and Vitest alike;
// workers need neither a TS loader nor a second copy of the server module graph.
// Only dense() performs arithmetic: it is the same compiled SIMD module as main.
const entry = `
const { workerData, parentPort } = require('node:worker_threads')
const { network, wasm, signal } = workerData
const state = new Int32Array(signal)
try {
  const kernel = new WebAssembly.Instance(wasm).exports
  const weights = [], biases = []
  let at = 16
  for (const layer of network.layers) {
    weights.push(at); at += layer.weight.byteLength
    biases.push(at); at += layer.bias.byteLength
  }
  const scratch = Math.ceil(at / 16) * 16
  const pages = Math.ceil(scratch / 65536) - kernel.memory.buffer.byteLength / 65536
  if (pages > 0) kernel.memory.grow(pages)
  network.layers.forEach((layer, i) => {
    new Float32Array(kernel.memory.buffer, weights[i], layer.weight.length).set(layer.weight)
    new Float32Array(kernel.memory.buffer, biases[i], layer.bias.length).set(layer.bias)
    // The private WASM copy is authoritative from here; release cloned tensors.
    layer.weight = undefined
    layer.bias = undefined
  })
  let capacity = 0, input, outputs, mask
  parentPort.on('message', ({ sharedInput, sharedOutputs, sharedMask, start, count }) => {
    try {
      if (count > capacity) {
        capacity = Math.max(64, count, capacity * 2)
        const floats = capacity * (network.layers[0].columns + network.layers.reduce((s, l) => s + l.rows, 0))
        const lastRows = network.layers.at(-1).rows
        const pages = Math.ceil((scratch + floats * 4 + lastRows) / 65536) - kernel.memory.buffer.byteLength / 65536
        if (pages > 0) kernel.memory.grow(pages)
        let at = scratch
        input = new Float32Array(kernel.memory.buffer, at, capacity * network.layers[0].columns)
        at += input.byteLength
        outputs = network.layers.map(layer => {
          const out = new Float32Array(kernel.memory.buffer, at, capacity * layer.rows)
          at += out.byteLength
          return out
        })
        mask = new Uint8Array(kernel.memory.buffer, at, lastRows)
      }
      const columns = network.layers[0].columns
      input.set(new Float32Array(sharedInput, start * columns * 4, count * columns))
      mask.set(new Uint8Array(sharedMask))
      let current = input
      network.layers.forEach((layer, i) => {
        const out = outputs[i]
        const last = i === network.layers.length - 1
        kernel.dense(current.byteOffset, weights[i], biases[i], out.byteOffset,
          layer.rows, layer.columns, count, layer.slope ?? 1, last ? mask.byteOffset : 0)
        const target = new Float32Array(sharedOutputs[i], start * layer.rows * 4, count * layer.rows)
        target.set(out.subarray(0, target.length))
        current = out
      })
      Atomics.store(state, 0, 2)
    } catch {
      Atomics.store(state, 0, -1)
    }
    Atomics.notify(state, 0)
  })
  Atomics.store(state, 0, 2)
} catch {
  Atomics.store(state, 0, -1)
}
Atomics.notify(state, 0)
`

const live = new Set<Worker>()
process.once('exit', () => {
  for (const worker of live) void worker.terminate()
})

interface Member {
  worker: Worker
  state: Int32Array
}

/** N includes the main thread. Selection is fixed on a network's first batch. */
export function requestedValueThreads(): number {
  const n = Number(process.env.RIVER_VALUE_THREADS ?? 1)
  // Bound accidental resource exhaustion; malformed settings preserve the default.
  return Number.isSafeInteger(n) && n >= 1 && n <= 32 ? n : 1
}

export class ValueWorkerPool {
  private readonly members: Member[] = []
  private capacity = 0
  private input!: Float32Array
  private outputs: Float32Array[] = []
  private readonly mask: Uint8Array
  private closed = false

  constructor(network: RiverValueNetwork, wasm: WebAssembly.Module, threads: number) {
    this.mask = new Uint8Array(new SharedArrayBuffer(network.layers.at(-1)?.rows ?? 0))
    try {
      for (let i = 1; i < threads; i += 1) {
        const state = new Int32Array(new SharedArrayBuffer(4))
        const worker = new Worker(entry, {
          eval: true,
          workerData: { network, wasm, signal: state.buffer },
        })
        const member = { worker, state }
        this.members.push(member)
        live.add(worker)
        worker.unref()
        // These callbacks run only once the synchronous solve yields. The bounded
        // atomic wait below is the crash detector while main is blocked.
        worker.on('error', () => this.close())
        worker.on('exit', () => {
          live.delete(worker)
          this.close()
        })
      }
      const deadline = performance.now() + 10_000
      for (const member of this.members) this.wait(member, deadline)
    } catch (error) {
      this.close()
      throw error
    }
  }

  get threads(): number {
    return this.closed ? 1 : this.members.length + 1
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const { worker } of this.members) {
      live.delete(worker)
      void worker.terminate()
    }
  }

  private wait({ state }: Member, deadline: number): void {
    while (true) {
      const status = Atomics.load(state, 0)
      if (status === 2) return
      if (status === -1) throw new Error('value worker failed')
      const remaining = deadline - performance.now()
      if (remaining <= 0) throw new Error('value worker timed out')
      Atomics.wait(state, 0, status, remaining)
    }
  }

  forward(
    network: RiverValueNetwork,
    input: Float32Array,
    batch: number,
    buffers: readonly Float32Array[],
    outputRows: Uint8Array | undefined,
    local: (
      input: Float32Array,
      batch: number,
      buffers: readonly Float32Array[],
      mask?: Uint8Array,
    ) => Float32Array,
  ): Float32Array | undefined {
    if (this.closed || batch < 2) return undefined
    try {
      if (batch > this.capacity) {
        this.capacity = Math.max(64, batch, this.capacity * 2)
        this.input = new Float32Array(
          new SharedArrayBuffer(this.capacity * (network.layers[0]?.columns ?? 0) * 4),
        )
        this.outputs = network.layers.map(
          (layer) => new Float32Array(new SharedArrayBuffer(this.capacity * layer.rows * 4)),
        )
      }
      this.input.set(input)
      for (let r = 0; r < this.mask.length; r += 1) this.mask[r] = outputRows?.[r] === 0 ? 0 : 1
      const parts = Math.min(batch, this.members.length + 1)
      const sharedOutputs = this.outputs.map((out) => out.buffer)
      const deadline = performance.now() + 30_000
      for (let i = 1; i < parts; i += 1) {
        const member = this.members[i - 1] as Member
        const start = Math.floor((batch * i) / parts)
        const end = Math.floor((batch * (i + 1)) / parts)
        Atomics.store(member.state, 0, 1)
        member.worker.postMessage({
          sharedInput: this.input.buffer,
          sharedOutputs,
          sharedMask: this.mask.buffer,
          start,
          count: end - start,
        })
      }
      const count = Math.floor(batch / parts)
      local(
        input.subarray(0, count * (network.layers[0]?.columns ?? 0)),
        count,
        this.outputs.map((out, i) => out.subarray(0, count * (network.layers[i]?.rows ?? 0))),
        outputRows,
      )
      for (let i = 1; i < parts; i += 1) this.wait(this.members[i - 1] as Member, deadline)
      // No caller buffer is touched until every worker succeeds. Timed-out workers
      // own only discarded SABs, so fallback cannot race with their late writes.
      for (let i = 0; i < buffers.length; i += 1) {
        const target = buffers[i] as Float32Array
        const source = this.outputs[i] as Float32Array
        if (i !== buffers.length - 1 || outputRows === undefined) {
          target.set(source.subarray(0, target.length))
        } else {
          const rows = this.mask.length
          for (let at = 0; at < target.length; at += 1) {
            if (this.mask[at % rows] !== 0) target[at] = source[at] as number
          }
        }
      }
      return buffers[buffers.length - 1]
    } catch {
      this.close()
      return undefined
    }
  }
}

export const valueWorkerFinalizer = new FinalizationRegistry<ValueWorkerPool>((pool) =>
  pool.close(),
)
