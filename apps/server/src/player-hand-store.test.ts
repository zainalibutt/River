import type { HandRecord } from '@river/engine'
import { parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { playerHandRows } from './player-hand-store.js'

const record: HandRecord = {
  handNumber: 7,
  startedAtMs: 0,
  stake: { smallBlind: 250, bigBlind: 500 },
  seats: [
    { seat: 0, playerId: 'alice', startingStack: 100_000 },
    { seat: 1, playerId: 'bot:nell', startingStack: 100_000 },
    { seat: 2, playerId: 'bob', startingStack: 100_000 },
  ],
  actions: [],
  board: [],
  potSize: 3_000,
  results: [
    { seat: 0, delta: 2_000, showed: true },
    { seat: 1, delta: -1_000, showed: false },
    { seat: 2, delta: -1_000, showed: false },
  ],
  commit: 'c0ffee',
  revealedSeed: null,
}

describe("a settled hand in each person's record", () => {
  it('gives each person a row of their own, with only their own cards, and bots none', () => {
    const holes = new Map([
      ['alice', [parseCard('As'), parseCard('Kd')]],
      ['bob', [parseCard('7c'), parseCard('2h')]],
    ])
    const rows = playerHandRows({
      roomId: 'room-1',
      record,
      playedAtMs: 1_000,
      roomKind: 'bots',
      isBot: (playerId) => playerId.startsWith('bot:'),
      nameOf: (playerId) => (playerId === 'bot:nell' ? 'Nell' : playerId),
      ownHoleOf: (playerId) => holes.get(playerId) ?? null,
    })
    expect(rows.map((row) => row.playerId)).toEqual(['alice', 'bob'])
    const [alice, bob] = rows
    expect(alice).toMatchObject({
      handId: 'room-1:7:c0ffee',
      bigBlind: 500,
      netChips: 2_000,
      showed: true,
      opponents: ['Nell', 'bob'],
    })
    expect(alice?.ownHole).toEqual(holes.get('alice'))
    expect(bob?.ownHole).toEqual(holes.get('bob'))
    // The record as broadcast carries no hole cards, so alice's row holds none of bob's.
    for (const card of holes.get('bob') ?? []) {
      expect(JSON.stringify(alice)).not.toContain(JSON.stringify(card))
    }
  })
})
