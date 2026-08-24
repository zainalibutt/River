import { makeDeck } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { FairnessClientSeed } from './fairness.js'
import { deckEntropy, fairDeck, fairnessCommit, fairShuffle } from './fairness.js'
import type { RoomEvent } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

const ALICE_SEED = '11'.repeat(32)
const BOB_SEED = '22'.repeat(32)
const SERVER_SEED_ONE = '33'.repeat(32)
const SERVER_SEED_TWO = '44'.repeat(32)

function seeds(...values: string[]): (size: number) => Uint8Array {
  let cursor = 0
  return (size) => {
    const value = values[cursor]
    cursor++
    if (value === undefined || value.length !== size * 2) {
      throw new Error('test entropy exhausted')
    }
    return Uint8Array.from(Buffer.from(value, 'hex'))
  }
}

function seatTwo(room: Room): void {
  room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' })
  room.submit({ kind: 'join', playerId: 'bob', name: 'Bob' })
  room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: 100_000 })
  room.submit({ kind: 'sit', playerId: 'bob', seat: 2, buyIn: 100_000 })
}

function settle(room: Room): RoomEvent[] {
  const events: RoomEvent[] = []
  let guard = 0
  while (room.viewFor('alice').phase === 'hand' && guard++ < 80) {
    const before = room.viewFor('alice').handNumber
    const actor = room.viewFor('alice').currentActor
    if (actor === null) break
    const legal = room.viewFor(actor.playerId).legal
    const result = legal?.check.enabled
      ? room.submit({ kind: 'act', playerId: actor.playerId, action: { kind: 'check' } })
      : legal?.call.enabled
        ? room.submit({ kind: 'act', playerId: actor.playerId, action: { kind: 'call' } })
        : room.submit({ kind: 'act', playerId: actor.playerId, action: { kind: 'fold' } })
    events.push(...result.events)
    if (room.viewFor('alice').handNumber !== before) break
  }
  return events
}

describe('multiplayer fairness', () => {
  it('commits before client seeds and records an exactly reproducible hand', () => {
    const room = new Room(
      'fairness-room',
      defaultRoomConfig({
        seed: 'legacy-room-value',
        inviteCode: 'RIVER2',
        seedCollectionMs: 1_000,
        randomBytes: seeds(SERVER_SEED_ONE),
      }),
    )
    seatTwo(room)
    const committed = room.submit({ kind: 'startHand' })
    expect(committed.events).toEqual([
      { kind: 'seedCommitted', handNumber: 1, commit: fairnessCommit(SERVER_SEED_ONE) },
    ])
    const commitment = committed.events.find(
      (event): event is Extract<RoomEvent, { kind: 'seedCommitted' }> =>
        event.kind === 'seedCommitted',
    )
    expect(room.viewFor('alice').phase).toBe('seeding')
    expect(room.viewFor('alice').seats[0]?.hole).toEqual([])
    room.submit({ kind: 'submitSeed', playerId: 'bob', seed: BOB_SEED })
    const started = room.submit({ kind: 'submitSeed', playerId: 'alice', seed: ALICE_SEED })
    expect(started.events.some((event) => event.kind === 'handStarted')).toBe(true)
    const events = settle(room)
    const reveal = events.find(
      (event): event is Extract<RoomEvent, { kind: 'seedRevealed' }> =>
        event.kind === 'seedRevealed',
    )
    expect(reveal).toEqual({
      kind: 'seedRevealed',
      handNumber: 1,
      serverSeed: SERVER_SEED_ONE,
      clientSeeds: [
        { playerId: 'alice', seat: 0, seed: ALICE_SEED, defaulted: false },
        { playerId: 'bob', seat: 2, seed: BOB_SEED, defaulted: false },
      ],
    })
    expect(fairnessCommit(reveal?.serverSeed ?? '')).toBe(commitment?.commit)
    const deck = fairDeck(makeDeck(), reveal?.serverSeed ?? '', reveal?.clientSeeds ?? [])
    const view = room.viewFor('alice')
    expect(view.seats[0]?.hole).toEqual([deck[0], deck[2]])
    expect(view.seats[2]?.hole).toEqual([deck[1], deck[3]])
    expect(view.board).toEqual(deck.slice(4, 9))
    expect(view.revealedSeed).toBe(SERVER_SEED_ONE)
    expect(view.clientSeeds).toEqual(reveal?.clientSeeds)
  })

  it('uses independent per-hand seeds and defaults missing client entropy', () => {
    const room = new Room(
      'independent-hands',
      defaultRoomConfig({
        seed: 'legacy-room-value',
        inviteCode: 'RIVER2',
        seedCollectionMs: 0,
        randomBytes: seeds(
          SERVER_SEED_ONE,
          ALICE_SEED,
          BOB_SEED,
          SERVER_SEED_TWO,
          BOB_SEED,
          ALICE_SEED,
        ),
      }),
    )
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    settle(room)
    const first = room.viewFor('alice')
    room.submit({ kind: 'startHand' })
    settle(room)
    const second = room.viewFor('alice')
    expect(first.revealedSeed).toBe(SERVER_SEED_ONE)
    expect(second.revealedSeed).toBe(SERVER_SEED_TWO)
    expect(first.clientSeeds?.every((seed) => seed.defaulted)).toBe(true)
    expect(second.clientSeeds?.every((seed) => seed.defaulted)).toBe(true)
    expect(fairnessCommit(second.revealedSeed ?? '')).toBe(second.commit)
  })

  it('keeps invite codes independent from the legacy room seed', () => {
    const first = defaultRoomConfig({
      seed: 'same-legacy-room-seed',
      randomBytes: seeds('00'.repeat(6)),
    })
    const second = defaultRoomConfig({
      seed: 'same-legacy-room-seed',
      randomBytes: seeds('ff'.repeat(6)),
    })
    expect(first.inviteCode).not.toBe(second.inviteCode)
  })

  it('has no positional bias across one million fair shuffles', () => {
    const cards = Array.from({ length: 52 }, (_, index) => index)
    const counts = Array.from({ length: 52 }, () => Array.from({ length: 52 }, () => 0))
    for (let run = 0; run < 1_000_000; run++) {
      const entropy = run.toString(16).padStart(64, '0')
      const deck = fairShuffle(cards, entropy)
      for (let position = 0; position < deck.length; position++) {
        const card = deck[position]
        if (card === undefined) throw new Error('missing shuffled card')
        const positionCounts = counts[position]
        if (positionCounts === undefined) throw new Error('missing position counts')
        positionCounts[card] = (positionCounts[card] ?? 0) + 1
      }
    }
    const expected = 1_000_000 / cards.length
    const chiSquares = counts.map((positionCounts) =>
      positionCounts.reduce((total, observed) => total + (observed - expected) ** 2 / expected, 0),
    )
    expect(Math.max(...chiSquares)).toBeLessThan(115)
  }, 120_000)
})

describe('fairness primitives', () => {
  it('mixes client seeds in public seat order', () => {
    const clientSeeds: FairnessClientSeed[] = [
      { playerId: 'bob', seat: 2, seed: BOB_SEED, defaulted: false },
      { playerId: 'alice', seat: 0, seed: ALICE_SEED, defaulted: false },
    ]
    expect(deckEntropy(SERVER_SEED_ONE, clientSeeds)).toBe(
      deckEntropy(SERVER_SEED_ONE, [...clientSeeds].reverse()),
    )
  })
})
