import type { Card, TurnAction } from '@river/engine'
import { buildReplay, conservesChips, DEFAULT_STAKE, summariseHand } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { HandRecorder } from './hand-recorder.js'
import type { RoomEvent, RoomHandle, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

const TEST_STACK = 100_000

function makeRoom(seed: string): Room {
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
  )
}

function seat(room: RoomHandle, playerIds: string[]): void {
  for (const playerId of playerIds) {
    room.submit({ kind: 'join', playerId, name: playerId })
  }
  playerIds.forEach((playerId, index) => {
    room.submit({ kind: 'sit', playerId, seat: index, buyIn: TEST_STACK })
  })
}

/** Check when possible, call when not. Produces a pure check-down. */
function passive(view: RoomView): TurnAction | null {
  const legal = view.legal
  if (legal === null) return null
  if (legal.check.enabled) return { kind: 'check' }
  if (legal.call.enabled) return { kind: 'call' }
  return null
}

function playOneHand(room: RoomHandle): RoomEvent[] {
  const seen: RoomEvent[] = []
  let guard = 0
  while (room.viewFor('alice').phase !== 'between' && guard++ < 120) {
    const actor = room.viewFor('alice').currentActor
    if (actor === null) break
    const action = passive(room.viewFor(actor.playerId))
    if (action === null) break
    seen.push(...room.submit({ kind: 'act', playerId: actor.playerId, action }).events)
  }
  return seen
}

function recordedIn(events: RoomEvent[]): RoomEvent[] {
  return events.filter((event) => event.kind === 'handRecorded')
}

function onlyRecord(events: RoomEvent[]) {
  const first = events[0]
  if (first === undefined || first.kind !== 'handRecorded') {
    throw new Error('no hand was recorded')
  }
  return first.record
}

const OPENING = {
  handNumber: 7,
  startedAtMs: 1_700_000_000_000,
  stake: { smallBlind: 250, bigBlind: 500 },
  seats: [
    { seat: 0, playerId: 'alice', startingStack: 10_000 },
    { seat: 2, playerId: 'bob', startingStack: 8_000 },
  ],
  commit: 'commit-7',
}

function closing(overrides: Partial<Parameters<HandRecorder['finish']>[0]> = {}) {
  return {
    board: [] as Card[],
    potSize: 1_000,
    finalStacks: new Map([
      [0, 10_500],
      [2, 7_500],
    ]),
    showedSeats: new Set<number>(),
    revealedSeed: null,
    ...overrides,
  }
}

describe('HandRecorder', () => {
  it('derives each seat delta from the stack it started and ended with', () => {
    const recorder = new HandRecorder()
    recorder.begin(OPENING)
    const record = recorder.finish(closing())
    expect(record?.results).toEqual([
      { seat: 0, delta: 500, showed: false },
      { seat: 2, delta: -500, showed: false },
    ])
  })

  it('keeps the pot the table counted rather than inferring it from deltas', () => {
    const recorder = new HandRecorder()
    recorder.begin({
      ...OPENING,
      seats: [
        { seat: 0, playerId: 'alice', startingStack: 10_000 },
        { seat: 1, playerId: 'bob', startingStack: 10_000 },
        { seat: 2, playerId: 'cara', startingStack: 10_000 },
      ],
    })
    const record = recorder.finish(
      closing({
        potSize: 1_500,
        finalStacks: new Map([
          [0, 11_000],
          [1, 9_500],
          [2, 9_500],
        ]),
      }),
    )
    if (record === null) throw new Error('expected a record')
    // Absolute deltas total 2,000 here. Only 1,500 was ever in the middle.
    expect(record.potSize).toBe(1_500)
    expect(summariseHand(record).potSize).toBe(1_500)
  })

  it('records each action against the street it was taken on', () => {
    const recorder = new HandRecorder()
    recorder.begin(OPENING)
    recorder.record(0, 'preflop', { kind: 'call' })
    recorder.record(2, 'flop', { kind: 'raiseTo', to: 1_200 })
    const record = recorder.finish(closing())
    expect(record?.actions).toEqual([
      { seat: 0, street: 'preflop', action: { kind: 'call' } },
      { seat: 2, street: 'flop', action: { kind: 'raiseTo', to: 1_200 } },
    ])
  })

  it('ignores an action when no hand is open', () => {
    const recorder = new HandRecorder()
    recorder.record(0, 'preflop', { kind: 'fold' })
    recorder.begin(OPENING)
    expect(recorder.finish(closing())?.actions).toEqual([])
  })

  it('returns null and stores nothing when finishing without an open hand', () => {
    const recorder = new HandRecorder()
    expect(recorder.finish(closing())).toBeNull()
    expect(recorder.recent()).toEqual([])
  })

  it('drops a hand that never settled rather than storing it half finished', () => {
    const recorder = new HandRecorder()
    recorder.begin(OPENING)
    recorder.record(0, 'preflop', { kind: 'call' })
    recorder.begin({ ...OPENING, handNumber: 8 })
    const record = recorder.finish(closing())
    expect(record?.handNumber).toBe(8)
    expect(record?.actions).toEqual([])
    expect(recorder.recent().map((hand) => hand.handNumber)).toEqual([8])
  })

  it('keeps only the most recent hands, newest first', () => {
    const recorder = new HandRecorder(3)
    for (const handNumber of [1, 2, 3, 4]) {
      recorder.begin({ ...OPENING, handNumber })
      recorder.finish(closing())
    }
    expect(recorder.recent().map((hand) => hand.handNumber)).toEqual([4, 3, 2])
    expect(recorder.recent(2).map((hand) => hand.handNumber)).toEqual([4, 3])
    expect(recorder.recent(0)).toEqual([])
  })

  it('refuses a limit that cannot hold a hand', () => {
    expect(() => new HandRecorder(0)).toThrow('positive integer')
  })

  it('copies the opening so a later mutation cannot rewrite history', () => {
    const recorder = new HandRecorder()
    const seats = [{ seat: 0, playerId: 'alice', startingStack: 10_000 }]
    recorder.begin({ ...OPENING, seats })
    const first = seats[0]
    if (first !== undefined) first.startingStack = 1
    const record = recorder.finish(closing({ finalStacks: new Map([[0, 10_000]]) }))
    expect(record?.results).toEqual([{ seat: 0, delta: 0, showed: false }])
  })
})

describe('a room recording the hand it just played', () => {
  it('emits exactly one record per settled hand', () => {
    const room = makeRoom('one-record')
    seat(room, ['alice', 'bob'])
    room.submit({ kind: 'startHand' })
    expect(recordedIn(playOneHand(room)).length).toBe(1)
  })

  it('counts a three way checked-down pot as three big blinds, not four', () => {
    const room = makeRoom('three-way-pot')
    seat(room, ['alice', 'bob', 'cara'])
    room.submit({ kind: 'startHand' })
    const record = onlyRecord(recordedIn(playOneHand(room)))

    expect(record.potSize).toBe(DEFAULT_STAKE.bigBlind * 3)
    expect(conservesChips(record)).toBe(true)
    expect(record.results.length).toBe(3)
  })

  it('records the stacks players actually sat down with', () => {
    const room = makeRoom('starting-stacks')
    seat(room, ['alice', 'bob'])
    room.submit({ kind: 'startHand' })
    const record = onlyRecord(recordedIn(playOneHand(room)))

    expect(record.seats.map((entry) => entry.startingStack)).toEqual([TEST_STACK, TEST_STACK])
    expect([...record.seats.map((entry) => entry.playerId)].sort()).toEqual(['alice', 'bob'])
    expect(record.commit.length).toBeGreaterThan(0)
    expect(record.revealedSeed).not.toBeNull()
  })

  it('carries no hole cards into the record', () => {
    const room = makeRoom('no-holes')
    seat(room, ['alice', 'bob'])
    room.submit({ kind: 'startHand' })
    const recorded = recordedIn(playOneHand(room))
    expect(recorded.length).toBe(1)
    expect(JSON.stringify(recorded[0])).not.toContain('hole')
  })

  it('hands a late joiner the hands it has already settled', () => {
    const room = makeRoom('late-joiner')
    seat(room, ['alice', 'bob'])
    room.submit({ kind: 'startHand' })
    playOneHand(room)
    const history = room.recentHands()
    expect(history.length).toBe(1)
    expect(history[0]?.handNumber).toBe(1)
  })

  it('replays a recorded hand into frames that end on the recorded pot', () => {
    const room = makeRoom('replayable')
    seat(room, ['alice', 'bob', 'cara'])
    room.submit({ kind: 'startHand' })
    playOneHand(room)
    const record = room.recentHands()[0]
    if (record === undefined) throw new Error('no hand was recorded')

    const frames = buildReplay(record)
    expect(frames.length).toBeGreaterThan(1)
    expect(frames[frames.length - 1]?.potAfter).toBe(record.potSize)
  })
})
