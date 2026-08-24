import type { Card } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { RoomHandle, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

/**
 * Adversarial coverage for the last acceptance item in
 * docs/design/12-multiplayer-ux.md: no transition path leaks another player's
 * hole cards.
 *
 * The steady-state rule in viewFor is easy to read and easy to trust. This
 * drives a whole hand and asserts the property after every single transition,
 * because a leak that only exists for one frame between two states is still a
 * leak, and is exactly the kind a spot check misses.
 */

const TEST_STACK = 100_000

function makeRoom(seed: string, deck?: Card[]): Room {
  let value = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0)
  return new Room(
    `room-${seed}`,
    defaultRoomConfig({
      seed,
      inviteCode: 'RIVER2',
      seedCollectionMs: 0,
      nowMs: () => 0,
      randomBytes: (size) =>
        Uint8Array.from({ length: size }, () => {
          value = (value + 29) & 255
          return value
        }),
    }),
    deck,
  )
}

function seatThree(room: RoomHandle): void {
  for (const playerId of ['alice', 'bob', 'carol']) {
    room.submit({ kind: 'join', playerId, name: playerId })
  }
  room.submit({ kind: 'sit', playerId: 'alice', seat: 0, buyIn: TEST_STACK })
  room.submit({ kind: 'sit', playerId: 'bob', seat: 2, buyIn: TEST_STACK })
  room.submit({ kind: 'sit', playerId: 'carol', seat: 4, buyIn: TEST_STACK })
}

/** Every seat that is not mine and not revealed must show no cards at all. */
function leaks(view: RoomView, viewerId: string): string[] {
  const found: string[] = []
  for (const seat of view.seats) {
    if (seat.playerId === null) continue
    if (seat.playerId === viewerId) continue
    if (seat.hole === null) continue
    if (view.revealed) continue
    found.push(`${viewerId} can see ${seat.playerId} hole at seat ${seat.seat}`)
  }
  return found
}

function assertNoLeaks(room: RoomHandle, label: string): void {
  for (const viewer of ['alice', 'bob', 'carol', 'spectator', '']) {
    const found = leaks(room.viewFor(viewer), viewer)
    expect(found, `${label}: ${found.join('; ')}`).toEqual([])
  }
}

function actUntilSettled(room: RoomHandle, label: string): void {
  for (let step = 0; step < 60; step++) {
    const view = room.viewFor('')
    const actor = view.currentActor
    if (actor === null) break
    const legal = room.viewFor(actor.playerId).legal
    if (legal === null) break
    room.submit({
      kind: 'act',
      playerId: actor.playerId,
      action: legal.check.enabled ? { kind: 'check' } : { kind: 'call' },
    })
    assertNoLeaks(room, `${label} after ${actor.playerId} acted`)
  }
}

describe('hidden information across transitions', () => {
  it('never shows another seat a hole card before showdown', () => {
    const room = makeRoom('leak-1')
    assertNoLeaks(room, 'empty room')
    seatThree(room)
    assertNoLeaks(room, 'after seating')
    room.submit({ kind: 'startHand' })
    assertNoLeaks(room, 'after the deal')
    actUntilSettled(room, 'in betting')
  })

  it('keeps holes hidden through a fold that ends the hand uncontested', () => {
    const room = makeRoom('leak-2')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    for (let step = 0; step < 10; step++) {
      const actor = room.viewFor('').currentActor
      if (actor === null) break
      room.submit({ kind: 'act', playerId: actor.playerId, action: { kind: 'fold' } })
      assertNoLeaks(room, 'during folds')
    }
  })

  it('keeps holes hidden while a player stands mid-hand', () => {
    const room = makeRoom('leak-3')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'stand', playerId: 'carol' })
    assertNoLeaks(room, 'after standing')
  })

  it('keeps holes hidden across a kick', () => {
    const room = makeRoom('leak-4')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    room.submit({
      kind: 'kick',
      byPlayerId: 'alice',
      targetPlayerId: 'carol',
      reason: 'host',
    })
    // Assert the kick actually landed, or this case proves nothing.
    const seats = room.viewFor('').seats
    expect(seats.some((seat) => seat.playerId === 'carol')).toBe(false)
    assertNoLeaks(room, 'after a kick')
  })

  it('keeps holes hidden across a disconnect and reconnect', () => {
    const room = makeRoom('leak-5')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'disconnect', playerId: 'bob' })
    assertNoLeaks(room, 'while disconnected')
    room.submit({ kind: 'reconnect', playerId: 'bob' })
    assertNoLeaks(room, 'after reconnect')
  })

  it('shows a player their own cards, or the property under test is vacuous', () => {
    const room = makeRoom('leak-6')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const own = room.viewFor('alice').seats.find((seat) => seat.playerId === 'alice')
    expect(own?.hole?.length, 'alice must be able to see her own hand').toBe(2)
  })

  it('never leaks through a second hand in the same room', () => {
    const room = makeRoom('leak-7')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    actUntilSettled(room, 'hand one')
    room.submit({ kind: 'startHand' })
    assertNoLeaks(room, 'hand two dealt')
    actUntilSettled(room, 'hand two')
  })

  it('reports hasHole without reporting which cards', () => {
    const room = makeRoom('leak-8')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const bobsSeat = room.viewFor('alice').seats.find((seat) => seat.playerId === 'bob')
    expect(bobsSeat?.hasHole).toBe(true)
    expect(bobsSeat?.hole).toBeNull()
  })

  it('gives an unknown viewer no cards at all', () => {
    const room = makeRoom('leak-9')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const view = room.viewFor('nobody-in-this-room')
    expect(view.seats.every((seat) => seat.hole === null)).toBe(true)
  })
})
