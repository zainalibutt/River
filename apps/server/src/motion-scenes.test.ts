import type { Card, TurnAction } from '@river/engine'
import { holeDealMs, parseCard, streetDealMs } from '@river/engine'
import { describe, expect, it } from 'vitest'
import type { RoomEvent, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

// The motion lab's hands, played on a real room and kept as the messages one player was sent.
// The web app replays them at /dev/motion to review the deal, the run-out and the showdown
// without a server, an account or a database. When the room changes what it sends, this test
// fails until the scenes are recorded again: `npx vitest run motion-scenes -u`.

interface Player {
  id: string
  seat: number
  buyIn: number
}

/** Who does what when it is their turn. */
type Policy = (view: RoomView, playerId: string) => TurnAction

interface MotionStep {
  /** When the message arrives, from the first message of the scene. */
  atMs: number
  view: RoomView
  events: RoomEvent[]
}

interface MotionScene {
  id: string
  title: string
  selfId: string
  steps: MotionStep[]
}

const STACK = 100_000
/** Between a player's turn opening and their action: long enough to read, short enough to watch. */
const THINK_MS = 1_300

function deckOf(text: string): Card[] {
  return text.split(' ').map((token) => parseCard(token))
}

/** Checks when it can and calls when it cannot: a hand played to the showdown. */
const passive: Policy = (view) =>
  view.legal?.check.enabled === true ? { kind: 'check' } : { kind: 'call' }

/** The first to act moves all in and everyone after calls it. */
function shoveThenCall(): Policy {
  let shoved = false
  return () => {
    if (shoved) return { kind: 'call' }
    shoved = true
    return { kind: 'allIn' }
  }
}

function record(
  id: string,
  title: string,
  players: readonly Player[],
  policy: Policy,
  deck?: Card[],
): MotionScene {
  let value = [...id].reduce((total, character) => total + character.charCodeAt(0), 0)
  const room = new Room(
    `motion-${id}`,
    defaultRoomConfig({
      seed: id,
      inviteCode: 'MOTION',
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
  const [self] = players
  if (self === undefined) throw new Error('a scene needs a player')
  for (const player of players) room.submit({ kind: 'join', playerId: player.id, name: player.id })
  for (const player of players) {
    room.submit({ kind: 'sit', playerId: player.id, seat: player.seat, buyIn: player.buyIn })
  }
  const seated = room.viewFor(self.id).seats.filter((seat) => seat.playerId !== null).length
  if (seated !== players.length) throw new Error(`${id}: ${seated} of ${players.length} seated`)
  const steps: MotionStep[] = [{ atMs: 0, view: room.viewFor(self.id), events: [] }]
  let at = 800
  let result = room.submit({ kind: 'startHand' })
  for (;;) {
    steps.push({ atMs: at, view: room.viewFor(self.id), events: result.events })
    // The next action waits for whatever this message set the dealer doing, then a beat.
    at += THINK_MS
    for (const event of result.events) {
      if (event.kind === 'handStarted') at += holeDealMs(players.length)
      if (event.kind === 'street') at += streetDealMs(event.cards.length, true)
    }
    const actor = room.viewFor(self.id).currentActor?.playerId
    if (actor === undefined || room.viewFor(self.id).phase !== 'hand') break
    result = room.submit({
      kind: 'act',
      playerId: actor,
      action: policy(room.viewFor(actor), actor),
    })
  }
  return { id, title, selfId: self.id, steps }
}

function scenes(): MotionScene[] {
  return [
    record(
      'allin-preflop',
      'All in before the flop, called: both hands face up, then the board a street at a time',
      [
        { id: 'alice', seat: 0, buyIn: STACK },
        { id: 'bob', seat: 2, buyIn: STACK },
      ],
      shoveThenCall(),
      deckOf('As 2c Ad 2d 5h 5c Ks Kd Qs Qd 9s'),
    ),
    record(
      'checked-down',
      'Three players checked down to the river: the showdown one hand at a time',
      [
        { id: 'alice', seat: 0, buyIn: STACK },
        { id: 'bob', seat: 1, buyIn: STACK },
        { id: 'cara', seat: 2, buyIn: STACK },
      ],
      passive,
    ),
    record(
      'allin-flop-side-pot',
      'Two all in on the flop and a call: a side pot, then the turn and river as a run-out',
      [
        { id: 'alice', seat: 0, buyIn: 50_000 },
        { id: 'bob', seat: 1, buyIn: STACK },
        { id: 'cara', seat: 2, buyIn: 200_000 },
      ],
      (view, playerId) =>
        view.street === 'preflop'
          ? passive(view, playerId)
          : playerId === 'cara'
            ? passive(view, playerId)
            : { kind: 'allIn' },
    ),
  ]
}

describe('motion lab scenes', () => {
  it('records each scene through to the end of the hand', () => {
    for (const scene of scenes()) {
      const last = scene.steps.at(-1)
      expect(
        last?.events.some((event) => event.kind === 'between'),
        scene.id,
      ).toBe(true)
    }
  })

  it('matches the scenes the web app replays', async () => {
    await expect(`${JSON.stringify(scenes())}\n`).toMatchFileSnapshot(
      '../../web/src/lib/motion-scenes.json',
    )
  })
})
