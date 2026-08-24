import type { Card, TurnAction } from '@river/engine'
import { parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { RoomEvent, RoomHandle, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

const TEST_STACK = 100_000
const DECK_11 = 'As 2c Ad 2d 5h 5c Ks Kd Qs Qd 9s'

function deckOf(text: string): Card[] {
  return text.split(' ').map((token) => parseCard(token))
}

function makeRoom(seed: string, deck?: Card[]): Room {
  return new Room(`room-${seed}`, defaultRoomConfig({ seed }), deck)
}

function seatTwo(room: RoomHandle): void {
  for (const playerId of ['alice', 'bob']) {
    room.submit({ kind: 'join', playerId, name: playerId })
  }
  room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: TEST_STACK })
  room.submit({ kind: 'sit', playerId: 'bob', seat: 2, buyIn: TEST_STACK })
}

function seatThree(room: RoomHandle): void {
  for (const playerId of ['alice', 'bob', 'cara']) {
    room.submit({ kind: 'join', playerId, name: playerId })
  }
  room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: TEST_STACK })
  room.submit({ kind: 'sit', playerId: 'bob', seat: 1, buyIn: TEST_STACK })
  room.submit({ kind: 'sit', playerId: 'cara', seat: 2, buyIn: TEST_STACK })
}

function simpleAction(view: RoomView): TurnAction | null {
  const legal = view.legal
  if (legal === null) return null
  if (legal.check.enabled) return { kind: 'check' }
  if (legal.call.enabled) return { kind: 'call' }
  if (legal.fold.enabled) return { kind: 'fold' }
  return null
}

function playToPhase(room: RoomHandle, expected: 'hand' | 'between'): RoomEvent[] {
  const seen: RoomEvent[] = []
  let guard = 0
  while (room.viewFor('alice').phase !== expected && guard++ < 80) {
    const actor = room.viewFor('alice').currentActor
    if (actor === null) break
    const action = simpleAction(room.viewFor(actor.playerId))
    if (action === null) break
    const result = room.submit({ kind: 'act', playerId: actor.playerId, action })
    seen.push(...result.events)
  }
  return seen
}

function snapshot(view: RoomView): string {
  return JSON.stringify(view)
}

describe('room lifecycle', () => {
  it('assigns the first joiner as host and migrates the role when they leave', () => {
    const room = makeRoom('host')
    room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' })
    room.submit({ kind: 'join', playerId: 'bob', name: 'Bob' })
    expect(room.viewFor('alice').hostPlayerId).toBe('alice')
    room.submit({ kind: 'leave', playerId: 'alice' })
    expect(room.viewFor('bob').hostPlayerId).toBe('bob')
  })

  it('rejects a supplied invite code that is not the room code', () => {
    const room = makeRoom('invite')
    room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' })
    const result = room.submit({ kind: 'join', playerId: 'bob', name: 'Bob', inviteCode: 'wrong' })
    expect(result).toMatchObject({
      ok: false,
      events: [{ message: 'That code does not match a table.' }],
    })
  })

  it('lets only the host remove a player and records the supplied reason', () => {
    const room = makeRoom('kick')
    seatThree(room)
    expect(
      room.submit({ kind: 'kick', byPlayerId: 'bob', targetPlayerId: 'cara', reason: 'host' }).ok,
    ).toBe(false)
    const result = room.submit({
      kind: 'kick',
      byPlayerId: 'alice',
      targetPlayerId: 'cara',
      reason: 'host',
    })
    expect(result.events).toContainEqual({ kind: 'kicked', playerId: 'cara', reason: 'host' })
    expect(room.viewFor('alice').seats[2]?.playerId).toBeNull()
  })

  it('joins players and rejects duplicates and empty names', () => {
    const room = makeRoom('join')
    expect(room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' }).ok).toBe(true)
    expect(room.submit({ kind: 'join', playerId: 'alice', name: 'Again' }).ok).toBe(false)
    expect(room.submit({ kind: 'join', playerId: 'ghost', name: '  ' }).ok).toBe(false)
  })

  it('assigns seats and rejects occupied or invalid seats', () => {
    const room = makeRoom('seats')
    for (const playerId of ['alice', 'bob']) {
      room.submit({ kind: 'join', playerId, name: playerId })
    }
    room.submit({ kind: 'sit', playerId: 'alice', seat: 3, buyIn: TEST_STACK })
    expect(room.submit({ kind: 'sit', playerId: 'bob', seat: 3, buyIn: TEST_STACK }).ok).toBe(false)
    expect(room.submit({ kind: 'sit', playerId: 'bob', seat: 19, buyIn: TEST_STACK }).ok).toBe(
      false,
    )
    expect(room.submit({ kind: 'sit', playerId: 'bob', seat: 4, buyIn: TEST_STACK }).ok).toBe(true)
  })

  it('enforces buy-in bounds', () => {
    const room = makeRoom('buyin')
    room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' })
    expect(room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: 100 }).ok).toBe(false)
    expect(room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: 1_000_000 }).ok).toBe(
      false,
    )
    expect(room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: TEST_STACK }).ok).toBe(
      true,
    )
  })

  it('allows standing and leaving only between hands', () => {
    const room = makeRoom('stand', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    expect(room.submit({ kind: 'stand', playerId: 'bob' }).ok).toBe(false)
    expect(room.submit({ kind: 'leave', playerId: 'bob' }).ok).toBe(false)
    playToPhase(room, 'between')
    expect(room.submit({ kind: 'stand', playerId: 'bob' }).ok).toBe(true)
    expect(room.viewFor('alice').seats.some((seat) => seat.playerId === 'bob')).toBe(false)
    expect(room.submit({ kind: 'leave', playerId: 'bob' }).ok).toBe(true)
    expect(room.submit({ kind: 'leave', playerId: 'bob' }).ok).toBe(false)
  })

  it('refuses to start a hand with fewer than two seated players', () => {
    const room = makeRoom('lonely')
    room.submit({ kind: 'join', playerId: 'alice', name: 'Alice' })
    room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: TEST_STACK })
    const result = room.submit({ kind: 'startHand' })
    expect(result.ok).toBe(false)
    expect(result.events[0]).toMatchObject({ kind: 'rejected' })
  })

  it('rotates the dealer and conserves total chips across hands', () => {
    const room = makeRoom('rotate', deckOf(DECK_11))
    seatThree(room)
    const base = room.totalChips()
    for (let hand = 1; hand <= 3; hand++) {
      room.submit({ kind: 'startHand' })
      playToPhase(room, 'between')
      expect(room.totalChips()).toBe(base)
      const dealerSeat = room.viewFor('alice').seats.find((seat) => seat.dealer)?.seat
      expect(dealerSeat).toBe(hand === 1 ? 0 : hand === 2 ? 1 : 2)
    }
  })
})

describe('room hand play', () => {
  it('deals deterministically with correct blind seats and hidden holes', () => {
    const room = makeRoom('deterministic', deckOf(DECK_11))
    seatThree(room)
    const started = room.submit({ kind: 'startHand' })
    expect(started.ok).toBe(true)
    expect(started.events[0]).toMatchObject({ kind: 'handStarted', dealerSeat: 0 })
    const blinds = started.events.findLast((e) => e.kind === 'blinds')
    expect(blinds).toEqual({
      kind: 'blinds',
      posts: [
        { seat: 1, amount: 250 },
        { seat: 2, amount: 500 },
      ],
    })
    const alice = room.viewFor('alice')
    expect(alice.seats[0]?.hole?.map((card) => card.rank + card.suit)).toEqual(['Ad', '5c'])
    expect(alice.seats[1]?.hole).toBeNull()
    expect(alice.currentActor?.playerId).toBe('alice')
    expect(room.viewFor('bob').seats[0]?.hole).toBeNull()
  })

  it('runs a full hand to showdown and returns money to stacks', () => {
    const room = makeRoom('fullhand', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const events = playToPhase(room, 'between')
    expect(room.viewFor('alice').phase).toBe('between')
    expect(events.some((event) => event.kind === 'showdown')).toBe(true)
    expect(room.totalChips()).toBe(300_000)
  })

  it('settles an uncontested hand when everyone else folds', () => {
    const room = makeRoom('foldall', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const first = room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'fold' } })
    expect(first.ok).toBe(true)
    const second = room.submit({ kind: 'act', playerId: 'bob', action: { kind: 'fold' } })
    expect(second.ok).toBe(true)
    expect(second.events.some((e) => e.kind === 'uncontested')).toBe(true)
    expect(room.viewFor('alice').phase).toBe('between')
    expect(room.totalChips()).toBe(300_000)
  })

  it('builds the board three at a time across street events', () => {
    const room = makeRoom('streets', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const events = playToPhase(room, 'between')
    const flop = events.find(
      (e): e is Extract<RoomEvent, { kind: 'street' }> =>
        e.kind === 'street' && e.street === 'flop',
    )
    const turn = events.find(
      (e): e is Extract<RoomEvent, { kind: 'street' }> =>
        e.kind === 'street' && e.street === 'turn',
    )
    const river = events.find(
      (e): e is Extract<RoomEvent, { kind: 'street' }> =>
        e.kind === 'street' && e.street === 'river',
    )
    expect(flop?.cards.length).toBe(3)
    expect(turn?.cards.length).toBe(1)
    expect(river?.cards.length).toBe(1)
  })

  it('emits an acted event before the resulting turn or street events', () => {
    const room = makeRoom('acted', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const result = room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'call' } })
    expect(result.events[0]).toEqual({
      kind: 'acted',
      playerId: 'alice',
      action: { kind: 'call' },
    })
  })

  it('does not mark a live all-in player as sitting out', () => {
    const room = makeRoom('allin-view', deckOf(DECK_11))
    for (const playerId of ['alice', 'bob', 'cara']) {
      room.submit({ kind: 'join', playerId, name: playerId })
    }
    room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: 50_000 })
    room.submit({ kind: 'sit', playerId: 'bob', seat: 1, buyIn: 50_000 })
    room.submit({ kind: 'sit', playerId: 'cara', seat: 2, buyIn: 50_000 })
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'allIn' } })
    expect(room.viewFor('alice').seats[0]).toMatchObject({
      stack: 0,
      allIn: true,
      sittingOut: false,
    })
  })
})

describe('room disconnect and reconnect', () => {
  it('auto-plays an away player with a check and completes the hand', () => {
    const room = makeRoom('away', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'disconnect', playerId: 'bob' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'call' } })
    const events = playToPhase(room, 'between')
    expect(events.some((e) => e.kind === 'awayPlayed' && e.action.kind === 'check')).toBe(true)
    expect(room.viewFor('alice').phase).toBe('between')
  })

  it('folds an away player who faces a bet', () => {
    const room = makeRoom('awayfold', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'disconnect', playerId: 'bob' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'call' } })
    const events = room.submit({
      kind: 'act',
      playerId: 'alice',
      action: { kind: 'raiseTo', to: 1500 },
    }).events
    expect(events.some((e) => e.kind === 'awayPlayed' && e.action.kind === 'fold')).toBe(true)
    expect(events.some((e) => e.kind === 'uncontested')).toBe(true)
  })

  it('folds an away player who faces a bet', () => {
    const room = makeRoom('awayfold', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'disconnect', playerId: 'bob' })
    const events = room.submit({
      kind: 'act',
      playerId: 'alice',
      action: { kind: 'raiseTo', to: 1500 },
    }).events
    expect(events.some((e) => e.kind === 'awayPlayed' && e.action.kind === 'fold')).toBe(true)
    expect(events.some((e) => e.kind === 'uncontested')).toBe(true)
  })

  it('reconnects a player into the same seat with a fresh view', () => {
    const room = makeRoom('reconnect')
    seatThree(room)
    room.submit({ kind: 'disconnect', playerId: 'cara' })
    expect(room.viewFor('cara').seats[2]?.disconnected).toBe(true)
    const re = room.submit({ kind: 'reconnect', playerId: 'cara' })
    expect(re.ok).toBe(true)
    expect(room.viewFor('cara').seats[2]?.disconnected).toBe(false)
  })

  it('does not repeat the current turn when another player disconnects', () => {
    const room = makeRoom('disconnect-waiting', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    expect(room.viewFor('alice').currentActor?.playerId).toBe('alice')
    expect(room.submit({ kind: 'disconnect', playerId: 'cara' }).events).toEqual([
      { kind: 'disconnected', playerId: 'cara' },
    ])
  })

  it('rejects duplicate disconnect and unknown ids', () => {
    const room = makeRoom('disc')
    seatThree(room)
    expect(room.submit({ kind: 'disconnect', playerId: 'ghost' }).ok).toBe(false)
    room.submit({ kind: 'disconnect', playerId: 'cara' })
    expect(room.submit({ kind: 'disconnect', playerId: 'cara' }).ok).toBe(false)
  })
})

describe('per-player projection and adversarial hidden information', () => {
  it('hides every other seat hole until showdown', () => {
    const room = makeRoom('hide', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    for (const seat of room.viewFor('alice').seats) {
      if (seat.playerId && seat.playerId !== 'alice') {
        expect(seat.hole).toBeNull()
      }
    }
    expect(room.viewFor('bob').seats[0]?.hole).toBeNull()
    playToPhase(room, 'between')
    expect(room.viewFor('alice').revealed).toBe(true)
  })

  it('keeps folded hole cards hidden at showdown', () => {
    const room = makeRoom('mucked', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'fold' } })
    playToPhase(room, 'between')
    const bob = room.viewFor('bob')
    expect(bob.revealed).toBe(true)
    expect(bob.seats[0]?.hole).toBeNull()
    expect(bob.seats[2]?.hole).toHaveLength(2)
  })

  it('is indistinguishable to a viewer across differing hidden hole assignments', () => {
    const roomA = makeRoom('blind', deckOf('As 2c Ad 2d 5h 5c Ks Kd Qs Qd 9s'))
    const roomB = makeRoom('blind', deckOf('As 2c Ad 7h 5h 5c Ks Kd Qs Qd 9s'))
    for (const room of [roomA, roomB]) {
      seatThree(room)
      room.submit({ kind: 'startHand' })
    }
    let guard = 0
    while (roomA.viewFor('alice').phase === 'hand' && guard++ < 80) {
      const actor = roomA.viewFor('alice').currentActor
      if (actor === null) break
      const action = simpleAction(roomA.viewFor(actor.playerId))
      if (action === null) break
      const resultA = roomA.submit({ kind: 'act', playerId: actor.playerId, action })
      const resultB = roomB.submit({ kind: 'act', playerId: actor.playerId, action })
      expect(resultA.ok).toBe(resultB.ok)
      const viewA = roomA.viewFor('alice')
      const viewB = roomB.viewFor('alice')
      if (!viewA.revealed && !viewB.revealed) {
        expect(snapshot(viewA)).toBe(snapshot(viewB))
      }
    }
    expect(roomA.viewFor('alice').phase).toBe('between')
  })
})
