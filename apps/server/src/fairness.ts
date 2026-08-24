import { createHash, randomBytes } from 'node:crypto'
import type { Card } from '@river/engine'

export interface FairnessClientSeed {
  playerId: string
  seat: number
  seed: string
  defaulted: boolean
}

function hashBytes(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return new Uint8Array(hash.digest())
}

function hexBytes(value: string): Uint8Array {
  if (!isFairnessSeed(value)) throw new Error('fairness seed must be 32 bytes of hex')
  return new Uint8Array(Buffer.from(value, 'hex'))
}

function uint32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

export function isFairnessSeed(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

export function freshFairnessSeed(source: (size: number) => Uint8Array = randomBytes): string {
  const bytes = source(32)
  if (bytes.length !== 32) throw new Error('fairness random source must return 32 bytes')
  return Buffer.from(bytes).toString('hex')
}

export function fairnessCommit(seed: string): string {
  return Buffer.from(hashBytes(hexBytes(seed))).toString('hex')
}

export function deckEntropy(
  serverSeed: string,
  clientSeeds: readonly FairnessClientSeed[],
): string {
  const ordered = [...clientSeeds].sort((left, right) => left.seat - right.seat)
  return Buffer.from(
    hashBytes(hexBytes(serverSeed), ...ordered.map((item) => hexBytes(item.seed))),
  ).toString('hex')
}

class Sha256CounterStream {
  private block: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  private offset = 0
  private counter = 0

  constructor(private readonly entropy: Uint8Array) {}

  takeByte(): number {
    if (this.offset >= this.block.length) {
      if (this.counter > 0xffff_ffff) throw new Error('fairness stream exhausted')
      this.block = hashBytes(this.entropy, uint32be(this.counter))
      this.offset = 0
      this.counter++
    }
    const value = this.block[this.offset]
    this.offset++
    if (value === undefined) throw new Error('fairness stream byte missing')
    return value
  }
}

function uniformIndex(stream: Sha256CounterStream, upperExclusive: number): number {
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive < 1) {
    throw new Error('fairness range must be a positive safe integer')
  }
  let bytes = 1
  let range = 256
  while (range < upperExclusive) {
    bytes++
    range *= 256
  }
  const limit = Math.floor(range / upperExclusive) * upperExclusive
  while (true) {
    let value = 0
    for (let index = 0; index < bytes; index++) value = value * 256 + stream.takeByte()
    if (value < limit) return value - Math.floor(value / upperExclusive) * upperExclusive
  }
}

export function fairShuffle<T>(cards: readonly T[], entropy: string): T[] {
  const result = [...cards]
  const stream = new Sha256CounterStream(hexBytes(entropy))
  for (let index = result.length - 1; index > 0; index--) {
    const swap = uniformIndex(stream, index + 1)
    const current = result[index]
    result[index] = result[swap] as T
    result[swap] = current as T
  }
  return result
}

export function fairDeck(
  cards: readonly Card[],
  serverSeed: string,
  clientSeeds: readonly FairnessClientSeed[],
): Card[] {
  return fairShuffle(cards, deckEntropy(serverSeed, clientSeeds))
}
