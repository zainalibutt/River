import { createHash } from 'node:crypto'
import { parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  isVerifySeed,
  recomputeCommit,
  recomputeDeck,
  recomputeDeckEntropy,
  recomputeFallbackCommit,
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

describe('checking the cards themselves', () => {
  const cards = (text: string) => text.split(' ').map((card) => parseCard(card))
  // The server's own fairDeck for these seeds, printed from apps/server/src/fairness.ts.
  const SERVER_DECK = cards('2d 4c 7c 7s Tc 9s 5c Qs 3c')
  const commit = serverCommit(SERVER_SEED)
  /** Heads up with Alice on the button: she is dealt first, then the board after both. */
  const dealt = (aliceHole: string, board: string) => ({
    board: cards(board),
    seats: [
      { seat: 0, hole: cards(aliceHole), dealer: true },
      { seat: 2, hole: null, dealer: false },
    ],
  })

  it('shuffles exactly as the server does', async () => {
    const deck = await recomputeDeck(SERVER_SEED, seats)
    expect(deck?.slice(0, 9)).toEqual(SERVER_DECK)
    expect(new Set(deck?.map((card) => card.rank + card.suit)).size).toBe(52)
  })

  it('passes a hand whose shown cards are the ones the deck deals', async () => {
    const result = await verifyHand(commit, SERVER_SEED, seats, dealt('2d 7c', 'Tc 9s 5c Qs 3c'))
    expect(result).toMatchObject({ status: 'match', cardsChecked: 7 })
  })

  it('fails a hand whose seed matches its commit but whose cards were not the deck', async () => {
    const swapped = await verifyHand(commit, SERVER_SEED, seats, dealt('2d 7c', 'Tc 9s 5c Qs As'))
    expect(swapped.status).toBe('mismatch')
    const wrongHole = await verifyHand(commit, SERVER_SEED, seats, dealt('7c 2d', 'Tc 9s 5c Qs 3c'))
    expect(wrongHole.status).toBe('mismatch')
  })

  it('fails a filled-in seed that is not the fallback committed before the deal', async () => {
    const committed = [
      { seat: 0, seed: ALICE_SEED },
      { seat: 2, seed: 'd'.repeat(64) },
    ]
    const fallbackCommit = (await recomputeFallbackCommit(committed)) ?? ''
    const defaulted = seats.map((entry) => ({ ...entry, defaulted: entry.playerId === 'alice' }))
    const honest = await verifyHand(commit, SERVER_SEED, defaulted, undefined, {
      commit: fallbackCommit,
      seeds: committed,
    })
    expect(honest.status).toBe('match')
    // Bob's seed is the one filled in now, and it is not what was committed for him.
    const swapped = seats.map((entry) => ({ ...entry, defaulted: entry.playerId === 'bob' }))
    const chosen = await verifyHand(commit, SERVER_SEED, swapped, undefined, {
      commit: fallbackCommit,
      seeds: committed,
    })
    expect(chosen.status).toBe('mismatch')
  })
})
