import type { Card, TurnAction } from '@river/engine'
import { holeDealMs, parseCard, streetDealMs } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { RoomEvent, RoomHandle, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

const TEST_STACK = 100_000
const DECK_11 = 'As 2c Ad 2d 5h 5c Ks Kd Qs Qd 9s'

function deckOf(text: string): Card[] {
  return text.split(' ').map((token) => parseCard(token))
}

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

function playToPhase(
  room: RoomHandle,
  expected: 'hand' | 'between',
  viewerId = 'alice',
): RoomEvent[] {
  const seen: RoomEvent[] = []
  let guard = 0
  while (room.viewFor(viewerId).phase !== expected && guard++ < 80) {
    const actor = room.viewFor(viewerId).currentActor
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

  it('allows standing only between hands, and leaving at any time', () => {
    const room = makeRoom('stand', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    expect(room.submit({ kind: 'stand', playerId: 'bob' }).ok).toBe(false)
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
  it('seats and deals to all nine player chairs without exposing another hand', () => {
    const room = makeRoom('nine-seated')
    for (let seat = 0; seat < 9; seat += 1) {
      const playerId = `player-${seat}`
      expect(room.submit({ kind: 'join', playerId, name: playerId }).ok).toBe(true)
      expect(room.submit({ kind: 'sit', playerId, seat, buyIn: TEST_STACK }).ok).toBe(true)
    }
    expect(room.viewFor('player-0').seats).toHaveLength(9)
    expect(room.submit({ kind: 'join', playerId: 'tenth', name: 'Tenth' }).ok).toBe(false)
    expect(room.submit({ kind: 'startHand' }).ok).toBe(true)
    const ninth = room.viewFor('player-8')
    expect(ninth.seats[8]?.hole).toHaveLength(2)
    expect(ninth.seats.slice(0, 8).every((seat) => seat.hole === null)).toBe(true)
    expect(room.viewFor('player-0').seats[8]?.hole).toBeNull()
    playToPhase(room, 'between', 'player-0')
    expect(room.totalChips()).toBe(9 * TEST_STACK)
  })

  it('deals deterministically with correct blind seats and hidden holes', () => {
    const room = makeRoom('deterministic', deckOf(DECK_11))
    seatThree(room)
    const started = room.submit({ kind: 'startHand' })
    expect(started.ok).toBe(true)
    expect(started.events).toContainEqual(
      expect.objectContaining({ kind: 'handStarted', dealerSeat: 0 }),
    )
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

describe('server-authoritative turn timers', () => {
  it('sets per-street deadlines and times out to check or fold without a client clock', () => {
    let now = 10_000
    const room = new Room(
      'turn-timer',
      defaultRoomConfig({
        seed: 'turn-timer',
        inviteCode: 'RIVER2',
        seedCollectionMs: 0,
        nowMs: () => now,
      }),
      deckOf(DECK_11),
    )
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    // The clock starts once the two hands have been dealt.
    expect(room.viewFor('alice')).toMatchObject({
      turnDeadlineMs: 10_000 + holeDealMs(2) + 15_000,
      turnBudgetMs: 15_000,
    })
    expect(room.dealSettlesAt()).toBe(10_000 + holeDealMs(2))
    // Heads-up the button acts first before the flop and completes in time.
    const button = room.viewFor('alice').currentActor
    if (button === null) throw new Error('missing first actor')
    expect(room.viewFor(button.playerId).legal?.check.enabled).toBe(false)
    const called = room.submit({ kind: 'act', playerId: button.playerId, action: { kind: 'call' } })
    expect(called.ok).toBe(true)
    // The big blind's option runs out, so it checks and the flop begins.
    const bigBlind = room.viewFor('alice').currentActor
    if (bigBlind === null) throw new Error('missing checking actor')
    expect(room.viewFor(bigBlind.playerId).legal?.check.enabled).toBe(true)
    now = 25_000
    const checked = room.submit({ kind: 'timeoutTurn' })
    expect(checked.events).toContainEqual({
      kind: 'timedOut',
      playerId: bigBlind.playerId,
      action: { kind: 'check' },
    })
    // And again once the flop has been dealt: the dealer's time is not the player's.
    expect(room.viewFor('alice')).toMatchObject({
      street: 'flop',
      turnDeadlineMs: 25_000 + streetDealMs(3, true) + 20_000,
      turnBudgetMs: 20_000,
    })
    const foldRoom = new Room(
      'turn-timeout-fold',
      defaultRoomConfig({
        seed: 'turn-timeout-fold',
        inviteCode: 'RIVER2',
        seedCollectionMs: 0,
        nowMs: () => now,
      }),
      deckOf(DECK_11),
    )
    now = 10_000
    seatTwo(foldRoom)
    foldRoom.submit({ kind: 'startHand' })
    now = 10_000 + holeDealMs(2) + 15_000
    const overdueActor = foldRoom.viewFor('alice').currentActor
    if (overdueActor === null) throw new Error('missing overdue actor')
    // The button faces the rest of the big blind, so a late action becomes a fold.
    const lateAction = foldRoom.submit({
      kind: 'act',
      playerId: overdueActor.playerId,
      action: { kind: 'call' },
    })
    expect(lateAction.events).toContainEqual(
      expect.objectContaining({ kind: 'timedOut', action: { kind: 'fold' } }),
    )
    expect(foldRoom.viewFor('alice').turnDeadlineMs).toBeNull()
  })
})

describe('leaving in the middle of a hand', () => {
  /** A room that holds each hand's seed collection open until told to deal. */
  function seedingRoom(seed: string): Room {
    return new Room(
      `room-${seed}`,
      defaultRoomConfig({
        seed,
        inviteCode: 'RIVER2',
        seedCollectionMs: 1_000,
        nowMs: () => 0,
        randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index),
      }),
      deckOf(DECK_11),
    )
  }

  it('folds a player who leaves on their own turn, and the turn moves on', () => {
    const room = makeRoom('leave-own-turn', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    expect(room.viewFor('bob').currentActor?.playerId).toBe('alice')
    const result = room.submit({ kind: 'leave', playerId: 'alice' })
    expect(result.ok).toBe(true)
    expect(result.events).toContainEqual({
      kind: 'acted',
      playerId: 'alice',
      action: { kind: 'fold' },
    })
    expect(result.events.at(-1)).toEqual({ kind: 'left', playerId: 'alice' })
    const view = room.viewFor('bob')
    expect(view.seats[0]?.playerId).toBeNull()
    expect(view.phase).toBe('hand')
    expect(view.currentActor?.playerId).toBe('bob')
    // Alice had bet nothing, so her whole stack went with her.
    expect(room.totalChips()).toBe(2 * TEST_STACK)
  })

  it('folds a player who leaves off their turn and leaves the turn in progress alone', () => {
    const room = makeRoom('leave-off-turn', deckOf(DECK_11))
    seatThree(room)
    room.submit({ kind: 'startHand' })
    const before = room.viewFor('alice')
    expect(before.currentActor?.playerId).toBe('alice')
    const result = room.submit({ kind: 'leave', playerId: 'bob' })
    expect(result.ok).toBe(true)
    expect(result.events).toEqual([
      { kind: 'acted', playerId: 'bob', action: { kind: 'fold' } },
      { kind: 'left', playerId: 'bob' },
    ])
    const view = room.viewFor('alice')
    expect(view.seats[1]?.playerId).toBeNull()
    expect(view.currentActor?.playerId).toBe('alice')
    expect(view.turnDeadlineMs).toBe(before.turnDeadlineMs)
    // His small blind stays in the pot; the rest of his stack went with him.
    expect(view.pot).toBe(750)
    const onTable = 3 * TEST_STACK - (TEST_STACK - 250)
    expect(room.totalChips()).toBe(onTable)
    const played = playToPhase(room, 'between')
    expect(room.totalChips()).toBe(onTable)
    // The hand's record has him down his blind, not his whole stack: the rest
    // left the table with him.
    const recorded = played.find((event) => event.kind === 'handRecorded')
    if (recorded?.kind !== 'handRecorded') throw new Error('expected the hand to be recorded')
    expect(recorded.record.results.find((result) => result.seat === 1)?.delta).toBe(-250)
  })

  it('ends the hand when the player who leaves was the last one against the actor', () => {
    const room = makeRoom('leave-heads-up', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    expect(room.viewFor('alice').currentActor?.playerId).toBe('alice')
    const result = room.submit({ kind: 'leave', playerId: 'bob' })
    expect(result.events).toContainEqual({ kind: 'uncontested', playerId: 'alice', amount: 750 })
    expect(result.events.at(-1)).toEqual({ kind: 'left', playerId: 'bob' })
    expect(room.viewFor('alice').phase).toBe('between')
    expect(room.viewFor('alice').seats[0]?.stack).toBe(TEST_STACK + 500)
    expect(room.totalChips()).toBe(TEST_STACK + 500)
  })

  it('plays an all-in hand out after its player leaves, then stands them up with what it won', () => {
    const room = makeRoom('leave-all-in', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'allIn' } })
    const left = room.submit({ kind: 'leave', playerId: 'alice' })
    // Nothing to fold: the hand is still hers, and her seat stays in it, away.
    expect(left).toEqual({ ok: true, events: [{ kind: 'disconnected', playerId: 'alice' }] })
    expect(room.viewFor('bob').seats[0]).toMatchObject({
      playerId: 'alice',
      allIn: true,
      folded: false,
      disconnected: true,
    })
    const called = room.submit({ kind: 'act', playerId: 'bob', action: { kind: 'call' } })
    // Aces against deuces: she wins it all, and it goes with her.
    expect(called.events).toContainEqual({
      kind: 'leftAfterHand',
      playerId: 'alice',
      seat: 0,
      stack: 2 * TEST_STACK,
    })
    expect(room.viewFor('bob').seats[0]?.playerId).toBeNull()
    expect(room.viewFor('bob').phase).toBe('between')
    expect(room.totalChips()).toBe(0)
  })

  it('stands an all-in leaver up with nothing when the hand is lost', () => {
    const room = makeRoom('leave-all-in-lost', deckOf('2c As 2d Ad 5h 5c Ks Kd Qs'))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'allIn' } })
    room.submit({ kind: 'leave', playerId: 'alice' })
    const called = room.submit({ kind: 'act', playerId: 'bob', action: { kind: 'call' } })
    expect(called.events).toContainEqual({
      kind: 'leftAfterHand',
      playerId: 'alice',
      seat: 0,
      stack: 0,
    })
    expect(room.totalChips()).toBe(2 * TEST_STACK)
  })

  it('keeps an all-in leaver in their seat if they come back before the hand ends', () => {
    const room = makeRoom('leave-all-in-return', deckOf(DECK_11))
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'act', playerId: 'alice', action: { kind: 'allIn' } })
    expect(room.submit({ kind: 'leave', playerId: 'alice' }).ok).toBe(true)
    expect(room.submit({ kind: 'reconnect', playerId: 'alice' })).toEqual({
      ok: true,
      events: [{ kind: 'reconnected', playerId: 'alice' }],
    })
    const called = room.submit({ kind: 'act', playerId: 'bob', action: { kind: 'call' } })
    expect(called.events.some((event) => event.kind === 'leftAfterHand')).toBe(false)
    expect(room.viewFor('alice').seats[0]).toMatchObject({
      playerId: 'alice',
      stack: 2 * TEST_STACK,
    })
  })

  it('gives a bet nobody left in the hand can win to the pot below it', () => {
    const room = makeRoom('leave-unmatched')
    for (const playerId of ['bea', 'cal', 'dot', 'abe']) {
      room.submit({ kind: 'join', playerId, name: playerId })
    }
    room.submit({ kind: 'sit', playerId: 'bea', seat: 0, buyIn: 60_000 })
    room.submit({ kind: 'sit', playerId: 'cal', seat: 1, buyIn: 50_000 })
    room.submit({ kind: 'sit', playerId: 'dot', seat: 2, buyIn: 100_000 })
    room.submit({ kind: 'sit', playerId: 'abe', seat: 3, buyIn: 200_000 })
    room.submit({ kind: 'startHand' })
    // Bea deals, Cal and Dot post the blinds, and Abe opens for half his stack.
    expect(room.viewFor('abe').currentActor?.playerId).toBe('abe')
    room.submit({ kind: 'act', playerId: 'abe', action: { kind: 'raiseTo', to: 100_000 } })
    room.submit({ kind: 'act', playerId: 'bea', action: { kind: 'allIn' } })
    room.submit({ kind: 'act', playerId: 'cal', action: { kind: 'allIn' } })
    expect(room.viewFor('dot').currentActor?.playerId).toBe('dot')
    room.submit({ kind: 'leave', playerId: 'abe' })
    const settled = room.submit({ kind: 'act', playerId: 'dot', action: { kind: 'fold' } })
    expect(settled.events.some((event) => event.kind === 'showdown')).toBe(true)
    // Nobody could match the last 40,000 of Abe's bet, and he has folded. It
    // stays on the table: only the 100,000 he had not bet went with him.
    expect(room.totalChips()).toBe(410_000 - 100_000)
  })

  it('deals to the others when somebody leaves while the cards are being shuffled', () => {
    const room = seedingRoom('leave-seeding')
    seatThree(room)
    room.submit({ kind: 'startHand' })
    expect(room.viewFor('alice').phase).toBe('seeding')
    expect(room.submit({ kind: 'leave', playerId: 'bob' })).toEqual({
      ok: true,
      events: [{ kind: 'left', playerId: 'bob' }],
    })
    expect(room.submit({ kind: 'finalizeSeeds' }).ok).toBe(true)
    const view = room.viewFor('alice')
    expect(view.phase).toBe('hand')
    expect(view.seats.filter((seat) => seat.hasHole).map((seat) => seat.playerId)).toEqual([
      'alice',
      'cara',
    ])
    expect(room.totalChips()).toBe(2 * TEST_STACK)
  })

  it('calls the deal off when a leave while shuffling leaves one player', () => {
    const room = seedingRoom('leave-seeding-alone')
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    const result = room.submit({ kind: 'leave', playerId: 'bob' })
    expect(result.ok).toBe(true)
    expect(result.events).toEqual([{ kind: 'left', playerId: 'bob' }])
    const view = room.viewFor('alice')
    // Back to before the deal, so the host can deal again once somebody sits.
    expect(view.phase).toBe('open')
    expect(view.handNumber).toBe(0)
    expect(view.seats[0]?.hasHole).toBe(false)
    expect(room.submit({ kind: 'finalizeSeeds' }).ok).toBe(false)
    expect(room.totalChips()).toBe(TEST_STACK)
  })

  it('goes back to the gap between hands when a later deal is called off', () => {
    const room = seedingRoom('leave-seeding-later')
    seatTwo(room)
    room.submit({ kind: 'startHand' })
    room.submit({ kind: 'finalizeSeeds' })
    playToPhase(room, 'between')
    room.submit({ kind: 'startHand' })
    const result = room.submit({ kind: 'leave', playerId: 'bob' })
    expect(result.events.map((event) => event.kind)).toEqual(['left', 'between'])
    expect(room.viewFor('alice')).toMatchObject({ phase: 'between', handNumber: 1 })
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
