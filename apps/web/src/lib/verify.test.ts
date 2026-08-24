import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  isVerifySeed,
  recomputeCommit,
  recomputeDeckEntropy,
  type VerifyClientSeed,
  verifyHand,
} from './verify.js'

const SERVER_SEED = 'a'.repeat(64)
const ALICE_SEED = 'b'.repeat(64)
const BOB_SEED = 'c'.repeat(64)

/** The server construction, rebuilt here with node:crypto as an independent path. */
function serverCommit(seed: string): string {
  return createHash('sha256').update(Buffer.from(seed, 'hex')).digest('hex')
}

function serverEntropy(seed: string, clientSeeds: VerifyClientSeed[]): string {
  const ordered = [...clientSeeds].sort((left, right) => left.seat - right.seat)
  const hash = createHash('sha256')
  hash.update(Buffer.from(seed, 'hex'))
  for (const entry of ordered) hash.update(Buffer.from(entry.seed, 'hex'))
  return hash.digest('hex')
}

const seats: VerifyClientSeed[] = [
  { playerId: 'bob', seat: 2, seed: BOB_SEED, defaulted: false },
  { playerId: 'alice', seat: 0, seed: ALICE_SEED, defaulted: false },
]

describe('client-side fairness verification', () => {
  it('recomputes the commit exactly as the server does', async () => {
    await expect(recomputeCommit(SERVER_SEED)).resolves.toBe(serverCommit(SERVER_SEED))
  })

  it('hashes seed bytes rather than the hex text', async () => {
    const textHash = createHash('sha256').update(SERVER_SEED, 'utf8').digest('hex')
    await expect(recomputeCommit(SERVER_SEED)).resolves.not.toBe(textHash)
  })

  it('recomputes deck entropy in seat order, not submission order', async () => {
    const expected = serverEntropy(SERVER_SEED, seats)
    await expect(recomputeDeckEntropy(SERVER_SEED, seats)).resolves.toBe(expected)
    await expect(recomputeDeckEntropy(SERVER_SEED, [...seats].reverse())).resolves.toBe(expected)
  })

  it('reports live while the seed is still hidden', async () => {
    const result = await verifyHand(serverCommit(SERVER_SEED), null, null)
    expect(result.status).toBe('live')
    expect(result.recomputedCommit).toBeNull()
  })

  it('reports idle before any commit exists', async () => {
    await expect(verifyHand(null, null, null)).resolves.toMatchObject({ status: 'idle' })
  })

  it('matches an honest revealed hand', async () => {
    const result = await verifyHand(serverCommit(SERVER_SEED), SERVER_SEED, seats)
    expect(result.status).toBe('match')
    expect(result.deckEntropy).toBe(serverEntropy(SERVER_SEED, seats))
  })

  it('flags a commit that does not match the revealed seed', async () => {
    const result = await verifyHand(serverCommit(ALICE_SEED), SERVER_SEED, seats)
    expect(result.status).toBe('mismatch')
  })

  it('flags a malformed revealed seed rather than passing it through', async () => {
    await expect(verifyHand(serverCommit(SERVER_SEED), 'nope', seats)).resolves.toMatchObject({
      status: 'mismatch',
    })
  })

  it('rejects seeds that are not 32 bytes of hex', () => {
    expect(isVerifySeed(SERVER_SEED)).toBe(true)
    expect(isVerifySeed('abc')).toBe(false)
    expect(isVerifySeed(`${'a'.repeat(63)}z`)).toBe(false)
  })
})
