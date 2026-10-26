// NumPy default_rng(0).permutation, pinned against the saved turn-start model.
import { createHash } from 'node:crypto'

export function historicalOrder(n = 53550) {
  let state = 35399562948360463058890781895381311971n
  const increment = 87136372517582989555478159403783844777n
  const mask = (1n << 128n) - 1n
  const mask64 = (1n << 64n) - 1n
  let spare: number | undefined
  const raw = () => {
    state = (state * 47026247687942121848144207491837523525n + increment) & mask
    const x = ((state >> 64n) ^ state) & mask64
    const rot = state >> 122n
    return ((x >> rot) | (x << (-rot & 63n))) & mask64
  }
  const next32 = () => {
    if (spare !== undefined) {
      const value = spare
      spare = undefined
      return value
    }
    const value = raw()
    spare = Number(value >> 32n)
    return Number(value & 0xffffffffn)
  }
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    let bits = i
    bits |= bits >>> 1
    bits |= bits >>> 2
    bits |= bits >>> 4
    bits |= bits >>> 8
    bits |= bits >>> 16
    let j: number
    do {
      j = next32() & bits
    } while (j > i)
    const tmp = order[i] as number
    order[i] = order[j] as number
    order[j] = tmp
  }
  const bytes = Buffer.alloc(n * 8)
  order.forEach((v, i) => {
    bytes.writeBigInt64LE(BigInt(v), 8 * i)
  })
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (
    n === 53550 &&
    sha256 !== 'e70b66b41f6d7c1dbf145e849efc3eed401cb6058e5abe77f5e8d2d2f62e4f1c'
  ) {
    throw new Error(`NumPy split reproduction failed: ${sha256}`)
  }
  return { order, sha256 }
}
