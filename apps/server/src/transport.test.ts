import {
  type BotObservationV1,
  type BotPolicy,
  DEFAULT_OPPONENT_MODEL_TUNING,
  type EconomyConfig,
  type OpponentModelStateV1,
  parseCard,
  type TurnAction,
  updateOpponentModel,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPlayer } from './auth.js'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1 } from './bot-learning-model.js'
import type { ActionShadowPort, PreparedActionShadow } from './bot-learning-shadow.js'
import { OnlineActionShadow } from './bot-learning-shadow.js'
import type { BotOpponentObservation, BotOpponentStore } from './bot-opponent-store.js'
import { type BotDecisionTrace, randomBotTable } from './bot-service.js'
import type { BotRiverThinker, ThinkRequest } from './bot-thinker.js'
import type { LedgerRow, SupabaseEconomy } from './economy-service.js'
import type { Ledger, LedgerEntry, Seating, SeatingStore } from './ledger.js'
import { defaultRoomConfig, Room, stakeForId, turnBudgetsForPreset } from './room.js'
import type { ClientPeer, RoomCreationSettings, ServerMessage } from './transport.js'
import { parseClientMessage, RoomHub } from './transport.js'

const ALICE = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const BOB = '78047f44-a536-4861-9d8f-784d77bda917'
const DEV = 'c1f9a4de-1f0b-4d4a-8a2c-2b6f0e5a7d31'

class MemoryLedger implements Ledger, SeatingStore {
  readonly balances = new Map([
    [ALICE, 100_000],
    [BOB, 100_000],
    [DEV, 100_000],
  ])
  readonly entries: LedgerEntry[] = []
  private readonly refs = new Map<string, LedgerEntry>()
  /** Every seating the book has heard of, by player and reference, and whether it has closed. */
  readonly seatings = new Map<string, { seating: Seating; closed: boolean }>()

  async open(seating: Seating): Promise<void> {
    const key = `${seating.playerId} ${seating.ref}`
    // Writing a seating again never reopens one that has closed.
    const closed = this.seatings.get(key)?.closed ?? false
    this.seatings.set(key, { seating: { ...seating }, closed })
  }

  async close(seating: Seating): Promise<void> {
    this.seatings.set(`${seating.playerId} ${seating.ref}`, {
      seating: { ...seating },
      closed: true,
    })
  }

  async unsettled(openedBeforeMs: number): Promise<Seating[]> {
    return [...this.seatings.values()]
      .filter((entry) => !entry.closed && entry.seating.openedAtMs < openedBeforeMs)
      .map((entry) => ({ ...entry.seating }))
  }

  async balance(playerId: string): Promise<number> {
    return this.balances.get(playerId) ?? 0
  }

  async apply(entry: LedgerEntry): Promise<number> {
    const key = `${entry.playerId}:${entry.ref}`
    const existing = this.refs.get(key)
    if (existing !== undefined) {
      if (existing.delta !== entry.delta || existing.reason !== entry.reason) {
        throw new Error('ledger ref reused with different entry')
      }
      return this.balance(entry.playerId)
    }
    const next = (this.balances.get(entry.playerId) ?? 0) + entry.delta
    if (next < 0) throw new Error('insufficient balance')
    this.refs.set(key, entry)
    this.entries.push(entry)
    this.balances.set(entry.playerId, next)
    return next
  }
}

class TestPeer implements ClientPeer {
  readonly messages: ServerMessage[] = []
  closed: { code: number; reason: string } | null = null

  send(message: string): void {
    this.messages.push(JSON.parse(message) as ServerMessage)
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }

  last(kind: ServerMessage['kind']): ServerMessage | undefined {
    return this.messages.findLast((message) => message.kind === kind)
  }
}

function setup(
  reconnectGraceMs = 30_000,
  seedCollectionMs = 0,
  turnBudgetsMs?: { preflop: number; flop: number; turn: number; river: number },
  socialRateLimit?: { maxActions: number; windowMs: number },
  economy?: SupabaseEconomy,
  botSeats: number | 'random' = 0,
  ledger = new MemoryLedger(),
  botPolicy?: BotPolicy,
  botTrace?: (trace: BotDecisionTrace) => void,
  botOpponentStore?: BotOpponentStore,
  onError?: (context: string, error: unknown) => void,
  actionShadow?: ActionShadowPort,
  botRiverThinker?: BotRiverThinker,
) {
  const players: Record<string, AuthenticatedPlayer> = {
    alice: { playerId: ALICE, anonymous: true, admin: false },
    aliceSaved: { playerId: ALICE, anonymous: false, admin: false },
    bob: { playerId: BOB, anonymous: false, admin: false },
    dev: { playerId: DEV, anonymous: false, admin: true },
  }
  const hub = new RoomHub({
    ledger,
    botSeats,
    // Fixed so a bot's choices are the same on every run.
    botRng: () => 0.42,
    ...(botPolicy === undefined ? {} : { botPolicy }),
    ...(botTrace === undefined ? {} : { botTrace }),
    ...(botOpponentStore === undefined ? {} : { botOpponentStore }),
    ...(onError === undefined ? {} : { onError }),
    ...(actionShadow === undefined ? {} : { actionShadow }),
    ...(botRiverThinker === undefined ? {} : { botRiverThinker }),
    ...(economy === undefined ? {} : { economy }),
    verifyToken: async (token) => {
      const player = players[token]
      if (player === undefined) throw new Error('invalid token')
      return player
    },
    createRoom: (roomId, settings?: RoomCreationSettings) =>
      new Room(
        roomId,
        defaultRoomConfig({
          seed: roomId,
          // The bot RNG below was fixed but the deck was not, so every run
          // dealt a different first hand. Most deals leave two players with
          // chips and the table deals on; some bust the table below two and
          // startHand rejects, which keepDealing swallows without rescheduling
          // - so the room stops dealing and the countdown test fails about one
          // run in twelve. Pinning the seed source makes these tests
          // deterministic. The swallowed rejection is a real defect and is
          // tracked separately; it is not what this suite is here to prove.
          randomBytes: (size: number) => Buffer.alloc(size, 0x2a),
          inviteCode: 'RIVER2',
          reconnectGraceMs,
          seedCollectionMs,
          ...(settings?.venueId === undefined ? {} : { venueId: settings.venueId }),
          ...(settings?.maxSeats === undefined ? {} : { maxSeats: settings.maxSeats }),
          ...(settings?.stakeId === undefined ? {} : { stake: stakeForId(settings.stakeId) }),
          ...(settings?.turnTimerPreset === undefined
            ? {}
            : {
                turnTimerPreset: settings.turnTimerPreset,
                turnBudgetsMs: turnBudgetsForPreset(settings.turnTimerPreset),
              }),
          ...(turnBudgetsMs === undefined ? {} : { turnBudgetsMs }),
          ...(socialRateLimit === undefined ? {} : { socialRateLimit }),
        }),
      ),
  })
  return { hub, ledger }
}

afterEach(() => vi.useRealTimers())

async function connectAndEnter(hub: RoomHub, token: string, name: string) {
  const peer = new TestPeer()
  const connection = hub.connect(peer)
  await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: token }))
  await connection.receive(
    JSON.stringify({
      kind: 'enter',
      requestId: `enter-${token}`,
      roomId: 'river-one',
      name,
      inviteCode: 'river2',
    }),
  )
  return { peer, connection }
}

describe('wire protocol parsing', () => {
  it('reads a look at the cards as a social command', () => {
    expect(
      parseClientMessage(
        JSON.stringify({ kind: 'social', requestId: 'look', command: { kind: 'peek' } }),
      ),
    ).toEqual({ kind: 'social', requestId: 'look', command: { kind: 'peek' } })
  })

  it('rejects malformed or unbounded messages', () => {
    expect(parseClientMessage('{')).toBeNull()
    expect(
      parseClientMessage(JSON.stringify({ kind: 'resync', requestId: 'spaces fail' })),
    ).toBeNull()
    expect(
      parseClientMessage(
        JSON.stringify({ kind: 'command', requestId: 'one', command: { kind: 'raiseTo' } }),
      ),
    ).toBeNull()
  })

  it('accepts only 32-byte client seed submissions', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          kind: 'command',
          requestId: 'seed',
          command: { kind: 'submitSeed', seed: 'ab'.repeat(32) },
        }),
      ),
    ).toMatchObject({ kind: 'command', command: { kind: 'submitSeed', seed: 'ab'.repeat(32) } })
    expect(
      parseClientMessage(
        JSON.stringify({
          kind: 'command',
          requestId: 'bad-seed',
          command: { kind: 'submitSeed', seed: 'bad' },
        }),
      ),
    ).toBeNull()
  })

  it('parses bounded social commands and rejects unknown emotes', () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          kind: 'social',
          requestId: 'social-one',
          command: { kind: 'chat', text: '  good hand  ' },
        }),
      ),
    ).toMatchObject({ kind: 'social', command: { kind: 'chat', text: 'good hand' } })
    expect(
      parseClientMessage(
        JSON.stringify({
          kind: 'social',
          requestId: 'social-two',
          command: { kind: 'emote', emote: 'unknown' },
        }),
      ),
    ).toBeNull()
  })

  it('accepts only configured table settings on enter', () => {
    const enter = {
      kind: 'enter',
      requestId: 'table-settings',
      roomId: 'river-settings',
      name: 'Alice',
      maxSeats: 6,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
      botSeats: 5,
      botPreset: 'mixed',
    }
    expect(parseClientMessage(JSON.stringify(enter))).toMatchObject(enter)
    expect(parseClientMessage(JSON.stringify({ ...enter, maxSeats: 9 }))).toMatchObject({
      ...enter,
      maxSeats: 9,
    })
    for (const invalid of [
      { ...enter, maxSeats: 5 },
      { ...enter, stakeId: '1000-2000' },
      { ...enter, turnTimerPreset: 'instant' },
      { ...enter, botSeats: 6 },
      { ...enter, botSeats: -1 },
      { ...enter, botPreset: 'expert' },
    ]) {
      expect(parseClientMessage(JSON.stringify(invalid))).toBeNull()
    }
  })

  it('lets a table ask for bots in every seat but one', () => {
    const enter = { kind: 'enter', requestId: 'nine', roomId: 'river-nine', name: 'Alice' }
    // Nine seats unless the table says otherwise, so eight bots and a person.
    expect(parseClientMessage(JSON.stringify({ ...enter, botSeats: 8 }))).toMatchObject({
      botSeats: 8,
    })
    expect(
      parseClientMessage(JSON.stringify({ ...enter, maxSeats: 9, botSeats: 8 })),
    ).toMatchObject({ botSeats: 8 })
    expect(
      parseClientMessage(JSON.stringify({ ...enter, maxSeats: 2, botSeats: 1 })),
    ).toMatchObject({ botSeats: 1 })
    for (const invalid of [
      { ...enter, botSeats: 9 },
      { ...enter, maxSeats: 6, botSeats: 6 },
      { ...enter, maxSeats: 2, botSeats: 2 },
    ]) {
      expect(parseClientMessage(JSON.stringify(invalid))).toBeNull()
    }
  })
})

describe('room hub', () => {
  it('runs a real forecast after an accepted table action without publishing its private snapshot', async () => {
    const frozen: ActionModelV1 = {
      version: 1,
      featureSchemaVersion: 2,
      featureNames: LEARNING_FEATURES_V2,
      labels: ACTION_LABELS,
      weights: ACTION_LABELS.map(() => Array(LEARNING_FEATURES_V2.length + 1).fill(0) as number[]),
      trainedExamples: 100,
      epochs: 1,
      temperature: 1,
    }
    const shadow = new OnlineActionShadow(frozen, frozen)
    const capture = vi.spyOn(shadow, 'prepare')
    const { hub } = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      shadow,
    )
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const snapshot = alice.peer.last('snapshot')
    if (snapshot?.kind !== 'snapshot') throw new Error('expected dealt snapshot')
    const actor = snapshot.view.currentActor?.playerId === ALICE ? alice : bob
    const actorSnapshot = actor.peer.last('snapshot')
    if (actorSnapshot?.kind !== 'snapshot') throw new Error('expected actor snapshot')
    const legalAction = actorSnapshot.view.legal?.check.enabled ? 'check' : 'call'
    await actor.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'real-shadow',
        command: { kind: 'act', action: { kind: legalAction } },
      }),
    )
    await shadow.flush()
    expect(shadow.stats()).toMatchObject({ forecasts: 1, failed: 0, pending: 0 })
    expect(shadow.stats().captureP95Ms).not.toBeNull()
    const privateSnapshot = capture.mock.results[0]?.value as
      | PreparedActionShadow
      | null
      | undefined
    expect(privateSnapshot?.features).toHaveLength(LEARNING_FEATURES_V2.length)
    expect(JSON.stringify(privateSnapshot)).not.toContain('hole')
    expect(JSON.stringify([...alice.peer.messages, ...bob.peer.messages])).not.toContain('actorKey')
  })

  it('feeds only accepted human actions to an opt-in shadow, once per request, without leaking it', async () => {
    const prepared: PreparedActionShadow = {
      actorKey: 'private-shadow-key',
      features: [0],
      legalLabels: ['fold', 'check', 'call', 'raise'],
      facingBet: false,
      actor: { betStreet: 0, stack: 1 },
      currentBet: 0,
    }
    const shadow: ActionShadowPort = {
      prepare: vi.fn(() => prepared),
      accepted: vi.fn(),
      forgetActor: vi.fn(),
    }
    const shadowErrors: string[] = []
    const { hub } = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
      undefined,
      undefined,
      undefined,
      (context) => shadowErrors.push(context),
      shadow,
    )
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const snapshot = alice.peer.last('snapshot')
    if (snapshot?.kind !== 'snapshot') throw new Error('expected dealt snapshot')
    const actor = snapshot.view.currentActor?.playerId === ALICE ? alice : bob
    const actorSnapshot = actor.peer.last('snapshot')
    if (actorSnapshot?.kind !== 'snapshot') throw new Error('expected actor snapshot')
    const legalAction = actorSnapshot.view.legal?.check.enabled ? 'check' : 'call'
    const actionRequest = JSON.stringify({
      kind: 'command',
      requestId: 'shadow-action',
      command: { kind: 'act', action: { kind: legalAction } },
    })
    await actor.connection.receive(actionRequest)
    expect(shadow.accepted).toHaveBeenCalledTimes(1)
    expect(shadow.accepted).toHaveBeenCalledWith(prepared, { kind: legalAction })
    await actor.connection.receive(actionRequest)
    expect(shadow.prepare).toHaveBeenCalledTimes(1)
    expect(shadow.accepted).toHaveBeenCalledTimes(1)
    await actor.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'not-your-turn',
        command: { kind: 'act', action: { kind: 'fold' } },
      }),
    )
    expect(actor.peer.last('error')).toMatchObject({
      requestId: 'not-your-turn',
      code: 'command_rejected',
    })
    expect(shadow.accepted).toHaveBeenCalledTimes(1)
    expect(JSON.stringify([...alice.peer.messages, ...bob.peer.messages])).not.toContain(
      'private-shadow-key',
    )
    shadow.prepare = () => {
      throw new Error('synthetic capture failure')
    }
    const nextSnapshot = bob.peer.last('snapshot')
    if (nextSnapshot?.kind !== 'snapshot') throw new Error('expected next snapshot')
    const nextActor = nextSnapshot.view.currentActor?.playerId === ALICE ? alice : bob
    await nextActor.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'capture-failure',
        command: { kind: 'act', action: { kind: 'fold' } },
      }),
    )
    expect(nextActor.peer.messages).toContainEqual(
      expect.objectContaining({ kind: 'snapshot', requestId: 'capture-failure' }),
    )
    expect(shadowErrors).toContain('action shadow prepare failed')
  })

  it('relays social systems without sending a poker snapshot', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    const snapshotsBefore = alice.peer.messages.filter(
      (message) => message.kind === 'snapshot',
    ).length
    await alice.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'chat',
        command: { kind: 'chat', text: 'good hand' },
      }),
    )
    expect(alice.peer.last('social')).toEqual({
      kind: 'social',
      roomId: 'river-one',
      requestId: 'chat',
      event: expect.objectContaining({ kind: 'chat', playerId: ALICE, text: 'good hand' }),
    })
    expect(bob.peer.last('social')).toEqual({
      kind: 'social',
      roomId: 'river-one',
      requestId: null,
      event: expect.objectContaining({ kind: 'chat', playerId: ALICE, text: 'good hand' }),
    })
    expect(alice.peer.messages.filter((message) => message.kind === 'snapshot')).toHaveLength(
      snapshotsBefore,
    )
    await alice.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'speak',
        command: { kind: 'speaking', speaking: true },
      }),
    )
    await alice.connection.close()
    expect(bob.peer.last('social')).toMatchObject({
      event: { kind: 'speaking', playerId: ALICE, speaking: false },
    })
  })

  it('shares the chat and emote throttle and blocks emotes on your turn', async () => {
    const { hub } = setup(30_000, 0, undefined, { maxActions: 1, windowMs: 10_000 })
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'chat',
        command: { kind: 'chat', text: 'hello' },
      }),
    )
    await alice.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'emote-rate',
        command: { kind: 'emote', emote: 'wave' },
      }),
    )
    expect(alice.peer.last('error')).toMatchObject({
      requestId: 'emote-rate',
      code: 'rate_limited',
    })
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const actor = alice.peer.last('snapshot')
    expect(actor?.kind).toBe('snapshot')
    if (actor?.kind !== 'snapshot') return
    const actorClient = actor.view.currentActor?.playerId === ALICE ? alice : bob
    await actorClient.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'turn-emote',
        command: { kind: 'emote', emote: 'wave' },
      }),
    )
    expect(actorClient.peer.last('error')).toMatchObject({
      requestId: 'turn-emote',
      code: 'emote_unavailable',
    })
  })

  describe('looking at your cards', () => {
    async function dealtIn(hub: RoomHub) {
      const alice = await connectAndEnter(hub, 'alice', 'Alice')
      const bob = await connectAndEnter(hub, 'bob', 'Bob')
      for (const [client, seat, requestId] of [
        [alice, 0, 'alice-sit'],
        [bob, 1, 'bob-sit'],
      ] as const) {
        await client.connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId,
            command: { kind: 'sit', seat, buyIn: 50_000 },
          }),
        )
      }
      await alice.connection.receive(
        JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
      )
      return { alice, bob }
    }

    function peeksIn(peer: TestPeer, playerId: string) {
      return peer.messages.filter(
        (message) =>
          message.kind === 'social' &&
          message.event.kind === 'peeked' &&
          message.event.playerId === playerId,
      ).length
    }

    const peek = (requestId: string) =>
      JSON.stringify({ kind: 'social', requestId, command: { kind: 'peek' } })

    it('shows the whole table a player lifting their cards', async () => {
      const { hub } = setup()
      const { alice, bob } = await dealtIn(hub)
      await alice.connection.receive(peek('look'))
      expect(peeksIn(bob.peer, ALICE)).toBe(1)
      expect(peeksIn(alice.peer, ALICE)).toBe(1)
    })

    it('is allowed on your own turn, which is when it matters most', async () => {
      const { hub } = setup()
      const { alice, bob } = await dealtIn(hub)
      const snapshot = alice.peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      const actor = snapshot.view.currentActor?.playerId === ALICE ? alice : bob
      const actorId = actor === alice ? ALICE : BOB
      await actor.connection.receive(peek('turn-look'))
      expect(actor.peer.last('error')).toBeUndefined()
      expect(peeksIn(alice.peer, actorId)).toBe(1)
    })

    it('treats pressing the cards over and over as one look', async () => {
      vi.useFakeTimers()
      const { hub } = setup()
      const { alice, bob } = await dealtIn(hub)
      await alice.connection.receive(peek('one'))
      await alice.connection.receive(peek('two'))
      await alice.connection.receive(peek('three'))
      expect(peeksIn(bob.peer, ALICE)).toBe(1)
      // Dropped quietly, not refused: there is nothing for the client to say about it.
      expect(alice.peer.last('error')).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1_300)
      await alice.connection.receive(peek('again'))
      expect(peeksIn(bob.peer, ALICE)).toBe(2)
    })

    it('does not spend the chat allowance', async () => {
      const { hub } = setup(30_000, 0, undefined, { maxActions: 1, windowMs: 10_000 })
      const { alice } = await dealtIn(hub)
      await alice.connection.receive(peek('look'))
      await alice.connection.receive(
        JSON.stringify({
          kind: 'social',
          requestId: 'chat',
          command: { kind: 'chat', text: 'hi' },
        }),
      )
      expect(alice.peer.last('error')).toBeUndefined()
    })

    it('holds a look open and lets it go, and never throttles the letting go', async () => {
      const { hub } = setup()
      const { alice, bob } = await dealtIn(hub)
      await alice.connection.receive(
        JSON.stringify({
          kind: 'social',
          requestId: 'hold',
          command: { kind: 'peek', holding: true },
        }),
      )
      await alice.connection.receive(
        JSON.stringify({
          kind: 'social',
          requestId: 'let',
          command: { kind: 'peek', holding: false },
        }),
      )
      const looks = bob.peer.messages.flatMap((message) =>
        message.kind === 'social' && message.event.kind === 'peeked' ? [message.event] : [],
      )
      expect(looks.map((event) => event.holding)).toEqual([true, false])
    })

    it('ignores a player with no cards to look at', async () => {
      const { hub } = setup()
      const alice = await connectAndEnter(hub, 'alice', 'Alice')
      const bob = await connectAndEnter(hub, 'bob', 'Bob')
      await alice.connection.receive(peek('nothing'))
      expect(peeksIn(bob.peer, ALICE)).toBe(0)
    })
  })

  it('interrupts active emotes when poker-critical progression begins', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'social',
        requestId: 'wave',
        command: { kind: 'emote', emote: 'wave' },
      }),
    )
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    expect(bob.peer.last('social')).toMatchObject({
      event: { kind: 'emoteInterrupted', playerId: ALICE },
    })
  })

  it('enforces a turn timeout without a client action', async () => {
    vi.useFakeTimers()
    const { hub } = setup(30_000, 0, { preflop: 20, flop: 20, turn: 20, river: 20 })
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    // The button completes the small blind in time; the big blind's option runs out.
    const dealt = alice.peer.last('snapshot')
    if (dealt?.kind !== 'snapshot') throw new Error('expected dealt snapshot')
    const button = dealt.view.currentActor?.playerId === ALICE ? alice : bob
    await button.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'complete',
        command: { kind: 'act', action: { kind: 'call' } },
      }),
    )
    await vi.advanceTimersByTimeAsync(20)
    expect(alice.peer.last('snapshot')).toMatchObject({
      view: { phase: 'hand', turnDeadlineMs: expect.any(Number) },
      events: expect.arrayContaining([
        expect.objectContaining({ kind: 'timedOut', action: { kind: 'check' } }),
      ]),
    })
  })

  it('defaults missing client entropy only after the commit has been broadcast', async () => {
    vi.useFakeTimers()
    const { hub } = setup(30_000, 20)
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'alice-sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await bob.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'bob-sit',
        command: { kind: 'sit', seat: 1, buyIn: 50_000 },
      }),
    )
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const committed = alice.peer.last('snapshot')
    expect(committed).toMatchObject({
      view: { phase: 'seeding' },
      events: [{ kind: 'seedCommitted' }],
    })
    await vi.advanceTimersByTimeAsync(20)
    const started = alice.peer.last('snapshot')
    expect(started).toMatchObject({
      view: { phase: 'hand' },
      events: expect.arrayContaining([expect.objectContaining({ kind: 'handStarted' })]),
    })
  })

  it('requires the room invite code after the host has created the table', async () => {
    const { hub } = setup()
    await connectAndEnter(hub, 'alice', 'Alice')
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'bob' }))
    await connection.receive(
      JSON.stringify({
        kind: 'enter',
        requestId: 'bad-invite',
        roomId: 'river-one',
        name: 'Bob',
        inviteCode: 'WRONG2',
      }),
    )
    expect(peer.last('error')).toMatchObject({
      requestId: 'bad-invite',
      code: 'join_rejected',
      message: 'That code does not match a table.',
    })
  })

  it('requires a verified token before room access', async () => {
    const { hub } = setup()
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(
      JSON.stringify({ kind: 'enter', requestId: 'enter', roomId: 'river-one', name: 'Alice' }),
    )
    expect(peer.last('error')).toMatchObject({ code: 'unauthenticated' })
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'wrong' }))
    expect(peer.closed).toEqual({ code: 4003, reason: 'Authentication failed' })
  })

  it('debits buy-ins, projects private cards, and ignores a spoofed player id', async () => {
    const { hub, ledger } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'alice-sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await bob.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'bob-sit',
        command: { kind: 'sit', seat: 1, buyIn: 50_000 },
      }),
    )
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )

    expect(ledger.balances.get(ALICE)).toBe(50_000)
    expect(ledger.balances.get(BOB)).toBe(50_000)
    const aliceSnapshot = alice.peer.last('snapshot')
    const bobSnapshot = bob.peer.last('snapshot')
    expect(aliceSnapshot?.kind).toBe('snapshot')
    expect(bobSnapshot?.kind).toBe('snapshot')
    if (aliceSnapshot?.kind !== 'snapshot' || bobSnapshot?.kind !== 'snapshot') return
    expect(aliceSnapshot.view.seats[0]?.hole).toHaveLength(2)
    expect(aliceSnapshot.view.seats[1]?.hole).toBeNull()
    expect(bobSnapshot.view.seats[0]?.hole).toBeNull()
    expect(bobSnapshot.view.seats[1]?.hole).toHaveLength(2)
    expect(aliceSnapshot.requestId).toBe('start')
    expect(bobSnapshot.requestId).toBeNull()

    const actorId = aliceSnapshot.view.currentActor?.playerId
    const attacker = actorId === ALICE ? bob : alice
    await attacker.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'spoof',
        command: { kind: 'act', playerId: actorId, action: { kind: 'call' } },
      }),
    )
    expect(attacker.peer.last('error')).toMatchObject({
      requestId: 'spoof',
      code: 'command_rejected',
      message: 'not your turn',
    })
  })

  it('reconnects to the same seat and returns the current authoritative view', async () => {
    const { hub } = setup()
    const first = await connectAndEnter(hub, 'alice', 'Alice')
    await first.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 3, buyIn: 50_000 },
      }),
    )
    await first.connection.close()

    const second = await connectAndEnter(hub, 'alice', 'Alice')
    const snapshot = second.peer.last('snapshot')
    expect(snapshot?.kind).toBe('snapshot')
    if (snapshot?.kind !== 'snapshot') return
    expect(snapshot.view.seats[3]).toMatchObject({
      playerId: ALICE,
      stack: 50_000,
      disconnected: false,
    })
  })

  it('keeps a player in their own turn when they open the table in a second tab', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const dealt = alice.peer.last('snapshot')
    if (dealt?.kind !== 'snapshot') throw new Error('expected a dealt snapshot')
    const actor = dealt.view.currentActor?.playerId
    const [token, name] = actor === ALICE ? ['alice', 'Alice'] : ['bob', 'Bob']

    const secondTab = await connectAndEnter(hub, token, name)
    const view = secondTab.peer.last('snapshot')
    if (view?.kind !== 'snapshot') throw new Error('expected a snapshot in the second tab')
    expect(view.view.handNumber).toBe(dealt.view.handNumber)
    expect(view.view.currentActor?.playerId).toBe(actor)
    expect(view.view.seats.find((seat) => seat.playerId === actor)).toMatchObject({
      folded: false,
      disconnected: false,
    })
  })

  it('still releases the seat when a second tab signs in and never comes back to the table', async () => {
    vi.useFakeTimers()
    const { hub, ledger } = setup(20)
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    const elsewhere = hub.connect(new TestPeer())
    await elsewhere.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'alice' }))
    expect(ledger.balances.get(ALICE)).toBe(50_000)
    await vi.advanceTimersByTimeAsync(45)
    expect(ledger.balances.get(ALICE)).toBe(100_000)
    expect(ledger.entries).toContainEqual(
      expect.objectContaining({ reason: 'table_reconnect_expiry_cash_out', delta: 50_000 }),
    )
  })

  it('credits a stand once when the same request is retried', async () => {
    const { hub, ledger } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    const stand = JSON.stringify({
      kind: 'command',
      requestId: 'stand',
      command: { kind: 'stand' },
    })
    await alice.connection.receive(stand)
    await alice.connection.receive(stand)
    expect(ledger.balances.get(ALICE)).toBe(100_000)
    expect(ledger.entries.filter((entry) => entry.reason === 'table_cash_out')).toHaveLength(1)
  })

  it('uses the ledger before releasing a kicked seat', async () => {
    const { hub, ledger } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'kick-bob',
        command: { kind: 'kick', targetPlayerId: BOB, reason: 'host' },
      }),
    )
    expect(ledger.balances.get(BOB)).toBe(100_000)
    expect(ledger.entries).toContainEqual(
      expect.objectContaining({ playerId: BOB, reason: 'table_kick_cash_out', delta: 50_000 }),
    )
    expect(alice.peer.last('snapshot')).toMatchObject({
      events: expect.arrayContaining([{ kind: 'kicked', playerId: BOB, reason: 'host' }]),
    })
  })

  it('returns a disconnected stack through the ledger when reconnect grace expires', async () => {
    vi.useFakeTimers()
    const { hub, ledger } = setup(20)
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await alice.connection.close()
    await vi.advanceTimersByTimeAsync(21)
    expect(ledger.balances.get(ALICE)).toBe(100_000)
    expect(ledger.entries).toContainEqual(
      expect.objectContaining({ reason: 'table_reconnect_expiry_cash_out', delta: 50_000 }),
    )
  })

  it('returns the stack of a second seating that expires at the same hand number', async () => {
    // Sitting down again before a hand is dealt used to give the second cash-out
    // the first one's ledger reference, and the ledger skips a reference it has
    // already applied.
    vi.useFakeTimers()
    const { hub, ledger } = setup(20)
    for (const round of [1, 2]) {
      const alice = await connectAndEnter(hub, 'alice', 'Alice')
      await alice.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId: `sit-${round}`,
          command: { kind: 'sit', seat: 0, buyIn: 50_000 },
        }),
      )
      expect(ledger.balances.get(ALICE)).toBe(50_000)
      await alice.connection.close()
      await vi.advanceTimersByTimeAsync(21)
      expect(ledger.balances.get(ALICE)).toBe(100_000)
    }
  })

  it('retries a reconnect expiry that lands while seeds are being collected', async () => {
    // The room removes nobody during seed collection. The expiry used to take
    // that refusal as final, so the seat and its stack stayed at the table.
    vi.useFakeTimers()
    const { hub, ledger } = setup(20, 1_000)
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [client, seat, requestId] of [
      [alice, 0, 'alice-sit'],
      [bob, 1, 'bob-sit'],
    ] as const) {
      await client.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId,
          command: { kind: 'sit', seat, buyIn: 50_000 },
        }),
      )
    }
    await bob.connection.close()
    await alice.connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    expect(alice.peer.last('snapshot')).toMatchObject({ view: { phase: 'seeding' } })
    await vi.advanceTimersByTimeAsync(21)
    await vi.advanceTimersByTimeAsync(5_000)
    const last = alice.peer.last('snapshot')
    if (last?.kind !== 'snapshot') throw new Error('expected a snapshot')
    expect(last.view.seats.some((seat) => seat.playerId === BOB)).toBe(false)
    // Dealt in before the retry landed, Bob can have lost at most the big blind.
    expect(ledger.balances.get(BOB)).toBeGreaterThanOrEqual(100_000 - 500)
  })

  it('announces an identity upgrade without moving a seat or ledger balance', async () => {
    const { hub, ledger } = setup()
    const first = await connectAndEnter(hub, 'alice', 'Alice')
    await first.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    const upgraded = await connectAndEnter(hub, 'aliceSaved', 'Alice')
    const snapshot = upgraded.peer.last('snapshot')
    expect(snapshot).toMatchObject({
      events: expect.arrayContaining([{ kind: 'identityUpgraded', playerId: ALICE }]),
      view: {
        seats: expect.arrayContaining([
          expect.objectContaining({ playerId: ALICE, stack: 50_000 }),
        ]),
      },
    })
    expect(ledger.balances.get(ALICE)).toBe(50_000)
  })
})

type Client = Awaited<ReturnType<typeof connectAndEnter>>

async function send(client: Client, requestId: string, command: unknown): Promise<void> {
  await client.connection.receive(JSON.stringify({ kind: 'command', requestId, command }))
}

function viewOf(client: Client) {
  const snapshot = client.peer.last('snapshot')
  if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
  return snapshot.view
}

/**
 * A hub over the given ledger, its rooms dealing from `deck` when there is one,
 * keeping its seatings in the ledger's book when asked to.
 */
function hubOver(ledger: MemoryLedger, options: { deck?: string; book?: boolean } = {}): RoomHub {
  const deck = options.deck?.split(' ').map((card) => parseCard(card))
  return new RoomHub({
    ledger,
    ...(options.book === true ? { seatings: ledger } : {}),
    verifyToken: async (token) => ({
      playerId: token === 'alice' ? ALICE : token === 'bob' ? BOB : DEV,
      anonymous: false,
      admin: false,
    }),
    createRoom: (roomId) =>
      new Room(
        roomId,
        defaultRoomConfig({
          seed: roomId,
          inviteCode: 'RIVER2',
          seedCollectionMs: 0,
          randomBytes: (size: number) => Buffer.alloc(size, 0x2a),
        }),
        deck,
      ),
  })
}

describe('leaving in the middle of a hand', () => {
  /** Every chip there is: what the ledger holds for each person, and what is on the table. */
  async function everyChip(ledger: MemoryLedger, watcher: Client): Promise<number> {
    const view = viewOf(watcher)
    const onTable = view.pot + view.seats.reduce((total, seat) => total + seat.stack, 0)
    let banked = 0
    for (const playerId of [ALICE, BOB, DEV]) banked += await ledger.balance(playerId)
    return banked + onTable
  }

  async function dealTo(tokens: readonly ('alice' | 'bob' | 'dev')[], deck?: string) {
    const ledger = new MemoryLedger()
    const hub = hubOver(ledger, deck === undefined ? {} : { deck })
    const clients: Client[] = []
    for (const [seat, token] of tokens.entries()) {
      const client = await connectAndEnter(hub, token, token)
      await send(client, `${token}-sit`, { kind: 'sit', seat, buyIn: 50_000 })
      clients.push(client)
    }
    const host = clients[0]
    if (host === undefined) throw new Error('nobody to deal')
    await send(host, 'deal', { kind: 'startHand' })
    return { ledger, clients, total: await everyChip(ledger, host) }
  }

  it('folds and pays out a player who leaves on their own turn', async () => {
    const { ledger, clients, total } = await dealTo(['alice', 'bob', 'dev'])
    const [alice, bob] = clients as [Client, Client, Client]
    expect(viewOf(bob).currentActor?.playerId).toBe(ALICE)
    await send(alice, 'alice-leave', { kind: 'leave' })
    // She had bet nothing, so her whole buy-in comes back, once, under the
    // reference of the request that asked for it.
    expect(await ledger.balance(ALICE)).toBe(100_000)
    expect(ledger.entries).toContainEqual({
      playerId: ALICE,
      delta: 50_000,
      reason: 'table_leave',
      ref: 'river-one:alice-leave:credit',
    })
    await send(alice, 'alice-leave', { kind: 'leave' })
    expect(ledger.entries.filter((entry) => entry.reason === 'table_leave')).toHaveLength(1)
    const view = viewOf(bob)
    expect(view.phase).toBe('hand')
    expect(view.seats[0]?.playerId).toBeNull()
    expect(view.currentActor?.playerId).toBe(BOB)
    expect(await everyChip(ledger, bob)).toBe(total)
  })

  it('folds and pays out a player who leaves off their turn, leaving their blind in the pot', async () => {
    const { ledger, clients, total } = await dealTo(['alice', 'bob', 'dev'])
    const [alice, bob] = clients as [Client, Client, Client]
    expect(viewOf(alice).currentActor?.playerId).toBe(ALICE)
    await send(bob, 'bob-leave', { kind: 'leave' })
    expect(await ledger.balance(BOB)).toBe(100_000 - 250)
    expect(ledger.entries).toContainEqual({
      playerId: BOB,
      delta: 50_000 - 250,
      reason: 'table_leave',
      ref: 'river-one:bob-leave:credit',
    })
    const view = viewOf(alice)
    expect(view.seats[1]?.playerId).toBeNull()
    expect(view.currentActor?.playerId).toBe(ALICE)
    expect(view.pot).toBe(750)
    expect(await everyChip(ledger, alice)).toBe(total)
  })

  /** Alice shoves on the button, leaves, and Bob calls her down. */
  async function shoveLeaveAndCall(deck: string) {
    const { ledger, clients, total } = await dealTo(['alice', 'bob'], deck)
    const [alice, bob] = clients as [Client, Client]
    expect(viewOf(alice).currentActor?.playerId).toBe(ALICE)
    await send(alice, 'alice-shove', { kind: 'act', action: { kind: 'allIn' } })
    await send(alice, 'alice-leave', { kind: 'leave' })
    // Nothing to fold and nothing to pay yet: the seat plays on, away.
    expect(ledger.entries.filter((entry) => entry.reason === 'table_leave')).toHaveLength(0)
    expect(viewOf(bob).seats[0]).toMatchObject({ playerId: ALICE, disconnected: true })
    await send(bob, 'bob-call', { kind: 'act', action: { kind: 'call' } })
    expect(viewOf(bob).phase).toBe('between')
    expect(viewOf(bob).seats[0]?.playerId).toBeNull()
    return { ledger, bob, total }
  }

  it('plays out an all-in hand after its player leaves, then pays what it won', async () => {
    // Aces for Alice, deuces for Bob.
    const { ledger, bob, total } = await shoveLeaveAndCall('As 2c Ad 2d 5h 5c Ks Kd Qs')
    expect(ledger.entries.filter((entry) => entry.reason === 'table_leave')).toEqual([
      { playerId: ALICE, delta: 100_000, reason: 'table_leave', ref: 'river-one:alice-sit:leave' },
    ])
    expect(await ledger.balance(ALICE)).toBe(150_000)
    expect(await everyChip(ledger, bob)).toBe(total)
  })

  it('pays an all-in leaver nothing when the hand is lost', async () => {
    const { ledger, bob, total } = await shoveLeaveAndCall('2c As 2d Ad 5h 5c Ks Kd Qs')
    expect(ledger.entries.filter((entry) => entry.reason === 'table_leave')).toEqual([])
    expect(await ledger.balance(ALICE)).toBe(50_000)
    expect(await everyChip(ledger, bob)).toBe(total)
  })
})

describe('buy-ins a crash left behind', () => {
  const NOON = Date.UTC(2026, 8, 29, 12)
  /** When the server that replaces the one that died starts. */
  const RESTART = NOON + 60_000
  /** Bob holds the aces, so Alice's shove loses everything she has. */
  const ALICE_LOSES = '2c As 2d Ad 5h 5c Ks Kd Qs'

  async function sitDown(hub: RoomHub, token: 'alice' | 'bob', seat: number): Promise<Client> {
    const client = await connectAndEnter(hub, token, token)
    await send(client, `${token}-sit`, { kind: 'sit', seat, buyIn: 50_000 })
    return client
  }

  /** Alice shoves and loses it all to Bob, who is left sitting on both stacks. */
  async function aliceBusts(hub: RoomHub) {
    const alice = await sitDown(hub, 'alice', 0)
    const bob = await sitDown(hub, 'bob', 1)
    await send(alice, 'deal', { kind: 'startHand' })
    await send(alice, 'shove', { kind: 'act', action: { kind: 'allIn' } })
    await send(bob, 'call', { kind: 'act', action: { kind: 'call' } })
    expect(viewOf(alice).seats[0]?.stack).toBe(0)
    return { alice, bob }
  }

  it('pays back the buy-in and rebuys of a seating a crash left open, once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON)
    const ledger = new MemoryLedger()
    const alice = await sitDown(hubOver(ledger, { book: true }), 'alice', 0)
    await send(alice, 'alice-rebuy', { kind: 'rebuy', amount: 20_000 })
    expect(await ledger.balance(ALICE)).toBe(30_000)
    // The server dies holding her seat, and nothing settles it.
    vi.setSystemTime(RESTART)
    const restarted = hubOver(ledger, { book: true })
    expect(await restarted.refundCrashedSeatings(RESTART)).toBe(1)
    expect(ledger.entries.at(-1)).toEqual({
      playerId: ALICE,
      delta: 70_000,
      reason: 'table_crash_refund',
      ref: 'river-one:alice-sit:crash-refund',
    })
    expect(await ledger.balance(ALICE)).toBe(100_000)
    const entries = ledger.entries.length
    expect(await restarted.refundCrashedSeatings(RESTART)).toBe(0)
    expect(ledger.entries).toHaveLength(entries)
    expect(await ledger.balance(ALICE)).toBe(100_000)
  })

  it('leaves a seating that was stood up from alone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON)
    const ledger = new MemoryLedger()
    const alice = await sitDown(hubOver(ledger, { book: true }), 'alice', 0)
    await send(alice, 'alice-stand', { kind: 'stand' })
    vi.setSystemTime(RESTART)
    expect(await hubOver(ledger, { book: true }).refundCrashedSeatings(RESTART)).toBe(0)
    expect(await ledger.balance(ALICE)).toBe(100_000)
  })

  it('leaves a seating that ended with nothing left alone, and refunds a buy-in, not a stack', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON)
    const ledger = new MemoryLedger()
    const { alice } = await aliceBusts(hubOver(ledger, { book: true, deck: ALICE_LOSES }))
    // Busted, she leaves. No chips move, so the ledger says nothing about it.
    await send(alice, 'alice-leave', { kind: 'leave' })
    expect(await ledger.balance(ALICE)).toBe(50_000)
    vi.setSystemTime(RESTART)
    // Only Bob's seating was open when the server died. He was sitting on
    // 100,000, but only the 50,000 he bought in with can be known.
    expect(await hubOver(ledger, { book: true }).refundCrashedSeatings(RESTART)).toBe(1)
    expect(await ledger.balance(ALICE)).toBe(50_000)
    expect(await ledger.balance(BOB)).toBe(100_000)
  })

  it('ignores a seating opened after this server started', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(RESTART + 1_000)
    // A server still winding down seats somebody after its replacement started.
    const ledger = new MemoryLedger()
    await sitDown(hubOver(ledger, { book: true }), 'alice', 0)
    expect(await hubOver(ledger, { book: true }).refundCrashedSeatings(RESTART)).toBe(0)
    expect(await ledger.balance(ALICE)).toBe(50_000)
  })

  it('never touches a seating at a table alive in this server', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON)
    const ledger = new MemoryLedger()
    const hub = hubOver(ledger, { book: true })
    await sitDown(hub, 'alice', 0)
    // Asked about everything opened before a moment after her seat, it still
    // leaves its own table alone.
    expect(await hub.refundCrashedSeatings(RESTART)).toBe(0)
    expect(await ledger.balance(ALICE)).toBe(50_000)
  })

  it('leaves nothing to refund after a graceful shutdown, not even a seat with nothing left', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON)
    const ledger = new MemoryLedger()
    const hub = hubOver(ledger, { book: true, deck: ALICE_LOSES })
    await aliceBusts(hub)
    await hub.settleAllTables()
    expect(await ledger.balance(BOB)).toBe(150_000)
    vi.setSystemTime(RESTART)
    expect(await hubOver(ledger, { book: true }).refundCrashedSeatings(RESTART)).toBe(0)
    expect(await ledger.balance(ALICE)).toBe(50_000)
    expect(await ledger.balance(BOB)).toBe(150_000)
  })

  it('does nothing without a book of seatings to read', async () => {
    const ledger = new MemoryLedger()
    await sitDown(hubOver(ledger), 'alice', 0)
    expect(await hubOver(ledger).refundCrashedSeatings(Date.now() + 60_000)).toBe(0)
    expect(ledger.seatings.size).toBe(0)
  })
})

describe('economy grants over the wire', () => {
  const CONFIG: EconomyConfig = {
    signupBankroll: 150_000,
    rescueFloor: 50_000,
    rescueThreshold: 1_000,
    rescueDailyCap: 3,
    dailyBase: 10_000,
    dailyStreakBonus: [0, 5_000, 10_000, 20_000, 30_000, 45_000, 90_000],
  }

  function grantEconomy(): SupabaseEconomy {
    return {
      async readRows(): Promise<LedgerRow[]> {
        return []
      },
      async readConfig(): Promise<EconomyConfig> {
        return CONFIG
      },
      async apply(): Promise<number> {
        return 110_000
      },
    }
  }

  it('clears a daily claim to the client with the new balance', async () => {
    const { hub } = setup(30_000, 0, undefined, undefined, grantEconomy())
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'alice' }))
    await connection.receive(JSON.stringify({ kind: 'claimDaily', requestId: 'daily-1' }))
    expect(peer.last('grant')).toMatchObject({
      requestId: 'daily-1',
      outcome: { kind: 'granted', delta: 10_000, balance: 110_000 },
    })
  })

  it('rejects a claim before authentication', async () => {
    const { hub } = setup(30_000, 0, undefined, undefined, grantEconomy())
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'claimRescue', requestId: 'rescue-1' }))
    expect(peer.last('error')).toMatchObject({ code: 'unauthenticated' })
  })

  it('treats seated rescue claims as not-eligible without crashing', async () => {
    const { hub } = setup(30_000, 0, undefined, undefined, grantEconomy())
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await alice.connection.receive(JSON.stringify({ kind: 'claimRescue', requestId: 'rescue-1' }))
    const outcome = alice.peer.last('grant')
    expect(outcome).toMatchObject({
      requestId: 'rescue-1',
      outcome: { kind: 'ineligible', reason: 'not-eligible' },
    })
  })
})

describe('resync', () => {
  it('answers with a full view and no event replay', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    await alice.connection.receive(JSON.stringify({ kind: 'resync', requestId: 'resync-1' }))
    const snapshot = alice.peer.messages.findLast(
      (message) => message.kind === 'snapshot' && message.requestId === 'resync-1',
    )
    expect(snapshot).toBeDefined()
    if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
    // A replay would arrive as events. The contract requires a full view.
    expect(snapshot.events).toEqual([])
    expect(snapshot.view.seats.length).toBeGreaterThan(0)
  })

  it('reflects state that changed while the client was not listening', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await bob.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit-bob',
        command: { kind: 'sit', seat: 2, buyIn: 100_000 },
      }),
    )
    await alice.connection.receive(JSON.stringify({ kind: 'resync', requestId: 'resync-2' }))
    const snapshot = alice.peer.messages.findLast(
      (message) => message.kind === 'snapshot' && message.requestId === 'resync-2',
    )
    if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
    const seated = snapshot.view.seats.filter((seat) => seat.playerId !== null)
    expect(seated.length).toBe(1)
    expect(snapshot.events).toEqual([])
  })

  it('does not hand a resyncing client another player’s hole cards', async () => {
    const { hub } = setup()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    for (const [who, seat] of [
      [alice, 0],
      [bob, 2],
    ] as const) {
      await who.connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId: `sit-${seat}`,
          command: { kind: 'sit', seat, buyIn: 100_000 },
        }),
      )
    }
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'deal',
        command: { kind: 'startHand' },
      }),
    )
    await alice.connection.receive(JSON.stringify({ kind: 'resync', requestId: 'resync-3' }))
    const snapshot = alice.peer.messages.findLast(
      (message) => message.kind === 'snapshot' && message.requestId === 'resync-3',
    )
    if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
    for (const seat of snapshot.view.seats) {
      if (seat.playerId !== null && seat.playerId !== snapshot.view.selfId) {
        expect(seat.hole).toBeNull()
      }
    }
  })
})

describe('which room a table is in', () => {
  async function enterWith(
    hub: RoomHub,
    token: string,
    roomId: string,
    venueId?: string,
    settings?: Record<string, unknown>,
  ) {
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: token }))
    await connection.receive(
      JSON.stringify({
        kind: 'enter',
        requestId: `enter-${token}`,
        roomId,
        name: token,
        inviteCode: 'river2',
        ...(venueId === undefined ? {} : { venueId }),
        ...settings,
      }),
    )
    return peer
  }

  function venueOfLast(peer: TestPeer): string | undefined {
    const snapshot = peer.last('snapshot')
    return snapshot?.kind === 'snapshot' ? snapshot.view.venueId : undefined
  }

  function settingsOfLast(peer: TestPeer) {
    const snapshot = peer.last('snapshot')
    return snapshot?.kind === 'snapshot' ? snapshot.view.tableSettings : undefined
  }

  function botSettingsOfLast(peer: TestPeer) {
    const snapshot = peer.last('snapshot')
    return snapshot?.kind === 'snapshot'
      ? { botSeats: snapshot.botSeats, botPreset: snapshot.botPreset }
      : undefined
  }

  it('opens a new table in the venue the link asked for', async () => {
    const { hub } = setup()
    expect(venueOfLast(await enterWith(hub, 'alice', 'river-suite', 'suite'))).toBe('suite')
  })

  it('still defaults to the rooftop when no venue is asked for', async () => {
    const { hub } = setup()
    expect(venueOfLast(await enterWith(hub, 'alice', 'river-plain'))).toBe('rooftop')
  })

  it('leaves an existing table where it is, whatever the joiner asks for', async () => {
    const { hub } = setup()
    await enterWith(hub, 'alice', 'river-shared', 'basement')
    const bob = await enterWith(hub, 'bob', 'river-shared', 'suite')
    // Two players at one table cannot be sitting in different rooms. Bob asked
    // for the Suite and gets the Laundromat, because that is where the table is.
    expect(venueOfLast(bob)).toBe('basement')
  })

  it('refuses a venue the wire made up', async () => {
    const { hub } = setup()
    const peer = await enterWith(hub, 'alice', 'river-junk', 'the-moon')
    expect(venueOfLast(peer)).toBeUndefined()
    expect(peer.last('error')).toMatchObject({ code: 'invalid_message' })
  })

  it('applies table settings from a creator and ignores a joiner', async () => {
    const { hub } = setup()
    const creator = await enterWith(hub, 'alice', 'river-settings', 'suite', {
      maxSeats: 6,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
      botSeats: 5,
      botPreset: 'tough',
    })
    expect(settingsOfLast(creator)).toEqual({
      maxSeats: 6,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
    })
    expect(botSettingsOfLast(creator)).toEqual({ botSeats: 5, botPreset: 'tough' })

    const joiner = await enterWith(hub, 'bob', 'river-settings', 'basement', {
      maxSeats: 2,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
      botSeats: 0,
      botPreset: 'casual',
    })
    expect(venueOfLast(joiner)).toBe('suite')
    expect(settingsOfLast(joiner)).toEqual(settingsOfLast(creator))
    expect(botSettingsOfLast(joiner)).toEqual(botSettingsOfLast(creator))
  })
})

describe('a table that stops existing', () => {
  it('hands every seated stack back when the server goes down', async () => {
    // The seat lives in this process and the bankroll lives in a database.
    // Restart the process and the seat is gone while the buy-in that paid for
    // it is not, which is how an account ends a session on exactly zero.
    const { hub, ledger } = setup()
    const { connection } = await connectAndEnter(hub, 'alice', 'Alice')
    await connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    expect(await ledger.balance(ALICE)).toBe(50_000)

    await hub.settleAllTables()
    expect(await ledger.balance(ALICE)).toBe(100_000)

    // Called twice - a second signal, or a close racing a timeout - settles once.
    await hub.settleAllTables()
    expect(await ledger.balance(ALICE)).toBe(100_000)
  })

  it('hands back a second seating at a table recreated after a restart', async () => {
    // A recreated table counts hands from zero again, so settling a new seating
    // at it used to repeat the previous settlement's ledger reference.
    const ledger = new MemoryLedger()
    for (const round of [1, 2]) {
      const { hub } = setup(30_000, 0, undefined, undefined, undefined, 0, ledger)
      const { connection } = await connectAndEnter(hub, 'alice', 'Alice')
      await connection.receive(
        JSON.stringify({
          kind: 'command',
          requestId: `sit-${round}`,
          command: { kind: 'sit', seat: 0, buyIn: 50_000 },
        }),
      )
      expect(await ledger.balance(ALICE)).toBe(50_000)
      await hub.settleAllTables()
      expect(await ledger.balance(ALICE)).toBe(100_000)
    }
  })
})

describe('the developer account', () => {
  async function send(hub: RoomHub, token: string, action: unknown, requestId = 'admin-1') {
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: token }))
    await connection.receive(JSON.stringify({ kind: 'admin', requestId, action }))
    return { peer, connection }
  }

  it('tells the client whether the account holds the role', async () => {
    const { hub } = setup()
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'dev' }))
    expect(peer.last('authenticated')).toMatchObject({ admin: true })

    const ordinary = new TestPeer()
    await hub
      .connect(ordinary)
      .receive(JSON.stringify({ kind: 'authenticate', accessToken: 'bob' }))
    expect(ordinary.last('authenticated')).toMatchObject({ admin: false })
  })

  it('grants chips and moves the balance', async () => {
    const { hub, ledger } = setup()
    const { peer } = await send(hub, 'dev', {
      kind: 'grantChips',
      targetPlayerId: BOB,
      amount: 50_000,
    })
    expect(peer.last('adminResult')).toMatchObject({
      outcome: { kind: 'chipsGranted', balance: 150_000 },
    })
    expect(await ledger.balance(BOB)).toBe(150_000)
  })

  it('refuses every action to an account without the role, and changes nothing', async () => {
    // The one that matters. If this ever passes for 'bob', anybody with a
    // browser console can print themselves chips and remove other players.
    const { hub, ledger } = setup()
    for (const token of ['bob', 'alice']) {
      const { peer } = await send(hub, token, {
        kind: 'grantChips',
        targetPlayerId: BOB,
        amount: 50_000,
      })
      expect(peer.last('adminResult')).toBeUndefined()
      expect(peer.last('error')).toMatchObject({ code: 'forbidden' })
    }
    expect(await ledger.balance(BOB)).toBe(100_000)
  })

  it('keeps a banned player out of every table', async () => {
    const { hub } = setup()
    await send(hub, 'dev', { kind: 'setBan', targetPlayerId: BOB, banned: true })

    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    expect(bob.peer.last('snapshot')).toBeUndefined()
    expect(bob.peer.last('error')).toMatchObject({ code: 'join_rejected' })

    // And lifting it lets them back in.
    await send(hub, 'dev', { kind: 'setBan', targetPlayerId: BOB, banned: false }, 'admin-2')
    const again = await connectAndEnter(hub, 'bob', 'Bob')
    expect(again.peer.last('snapshot')).toBeDefined()
  })

  it('rejects a malformed action at the wire rather than in the handler', async () => {
    expect(parseClientMessage(JSON.stringify({ kind: 'admin', requestId: 'a' }))).toBeNull()
    expect(
      parseClientMessage(
        JSON.stringify({ kind: 'admin', requestId: 'a', action: { kind: 'dropDatabase' } }),
      ),
    ).toBeNull()
    expect(
      parseClientMessage(
        JSON.stringify({
          kind: 'admin',
          requestId: 'a',
          action: { kind: 'grantChips', targetPlayerId: BOB, amount: 'lots' },
        }),
      ),
    ).toBeNull()
  })
})

describe('bots at the table', () => {
  const withBots = () => setup(30_000, 0, undefined, undefined, undefined, 5)

  async function sitAndStart(hub: RoomHub, token = 'alice') {
    const { peer, connection } = await connectAndEnter(hub, token, 'Alice')
    await connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    return { peer, connection }
  }

  function seatsIn(peer: TestPeer) {
    const snapshot = peer.last('snapshot')
    if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
    return snapshot.view.seats
  }

  it('leaves a table alone unless the hub asked for bots', async () => {
    const { hub } = setup()
    const { peer } = await sitAndStart(hub)
    expect(seatsIn(peer).filter((seat) => seat.playerId !== null).length).toBe(1)
  })

  it('fills the empty seats when a hand starts', async () => {
    const { hub } = withBots()
    const { peer } = await sitAndStart(hub)
    const seated = seatsIn(peer).filter((seat) => seat.playerId !== null)
    expect(seated.length).toBeGreaterThan(1)
    // One seat is always kept free for the next person to arrive.
    expect(seated.length).toBeLessThan(seatsIn(peer).length)
  })

  it('fills the ninth seat when the table asks for eight bots', async () => {
    const { hub } = setup()
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'alice' }))
    await connection.receive(
      JSON.stringify({
        kind: 'enter',
        requestId: 'enter-nine',
        roomId: 'river-nine',
        name: 'Alice',
        botSeats: 8,
      }),
    )
    await connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    const seats = seatsIn(peer)
    expect(seats).toHaveLength(9)
    expect(seats.every((seat) => seat.playerId !== null)).toBe(true)
    expect(seats[8]?.playerId?.startsWith('bot:')).toBe(true)
    expect(peer.last('snapshot')).toMatchObject({ botSeats: 8 })
  })

  /** Alice opens a table, sits in the first chair and deals. */
  async function openTable(hub: RoomHub, roomId: string, settings: Record<string, unknown> = {}) {
    const peer = new TestPeer()
    const connection = hub.connect(peer)
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'alice' }))
    await connection.receive(
      JSON.stringify({ kind: 'enter', requestId: 'enter', roomId, name: 'Alice', ...settings }),
    )
    await connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'start', command: { kind: 'startHand' } }),
    )
    return peer
  }

  function botSeatsIn(peer: TestPeer): number[] {
    return seatsIn(peer)
      .filter((seat) => seat.playerId?.startsWith('bot:') === true)
      .map((seat) => seat.seat)
  }

  describe('a 1v1 table against the champion', () => {
    it('seats Nell alone opposite the player, heads-up, even where tables fill at random', async () => {
      const { hub } = setup(30_000, 0, undefined, undefined, undefined, 'random')
      const peer = await openTable(hub, 'river-nell', { botPreset: 'champion' })
      const snapshot = peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      expect(snapshot).toMatchObject({ botSeats: 1, botPreset: 'champion' })
      expect(snapshot.view.tableSettings?.maxSeats).toBe(2)
      expect(snapshot.view.seats.map((seat) => seat.playerId)).toEqual([ALICE, 'bot:nell'])
      expect(snapshot.view.phase).toBe('hand')
    })

    it('is a table setting the wire checks like the others', () => {
      const enter = { kind: 'enter', requestId: 'nell', roomId: 'river-nell', name: 'Alice' }
      expect(parseClientMessage(JSON.stringify({ ...enter, botPreset: 'champion' }))).toMatchObject(
        { botPreset: 'champion', maxSeats: 2, botSeats: 1 },
      )
      expect(
        parseClientMessage(
          JSON.stringify({ ...enter, botPreset: 'champion', maxSeats: 2, botSeats: 1 }),
        ),
      ).toMatchObject({ botPreset: 'champion', maxSeats: 2, botSeats: 1 })
      for (const invalid of [
        { ...enter, botPreset: 'champion', maxSeats: 9 },
        { ...enter, botPreset: 'champion', maxSeats: 6 },
        { ...enter, botPreset: 'champion', botSeats: 0 },
        { ...enter, botPreset: 'champion', botSeats: 2 },
        { ...enter, botPreset: 'Champion' },
      ]) {
        expect(parseClientMessage(JSON.stringify(invalid))).toBeNull()
      }
    })
  })

  describe('a table that did not say how many bots it wants', () => {
    const ROOMS = ['river-one', 'river-a1', 'river-b2', 'river-c3', 'river-d4', 'river-e5']

    it('seats the number and the seats its room id draws, three to eight at nine seats', async () => {
      for (const roomId of ROOMS) {
        const { hub } = setup(30_000, 0, undefined, undefined, undefined, 'random')
        const peer = await openTable(hub, roomId)
        const drawn = randomBotTable(roomId, 9)
        expect(drawn.count).toBeGreaterThanOrEqual(3)
        expect(drawn.count).toBeLessThanOrEqual(8)
        expect(peer.last('snapshot')).toMatchObject({ botSeats: drawn.count })
        const expected = drawn.order.filter((seat) => seat !== 0).slice(0, drawn.count)
        expect(botSeatsIn(peer).sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b))
      }
    })

    it('finds the same table after a restart', async () => {
      for (const roomId of ROOMS) {
        const first = await openTable(
          setup(30_000, 0, undefined, undefined, undefined, 'random').hub,
          roomId,
        )
        const again = await openTable(
          setup(30_000, 0, undefined, undefined, undefined, 'random').hub,
          roomId,
        )
        const cast = (peer: TestPeer) =>
          seatsIn(peer).map((seat) => (seat.playerId?.startsWith('bot:') ? seat.playerId : null))
        expect(botSeatsIn(first).length).toBeGreaterThanOrEqual(3)
        expect(cast(again)).toEqual(cast(first))
      }
    })

    it('puts the champion at every one of them exactly once', async () => {
      for (const roomId of ROOMS) {
        const { hub } = setup(30_000, 0, undefined, undefined, undefined, 'random')
        const peer = await openTable(hub, roomId)
        const nell = seatsIn(peer).filter((seat) => seat.playerId === 'bot:nell')
        expect(nell).toHaveLength(1)
      }
    })

    it('takes a number the creator gives it, and leaves those bots in seat order', async () => {
      const { hub } = setup(30_000, 0, undefined, undefined, undefined, 'random')
      const peer = await openTable(hub, 'river-counted', { botSeats: 4 })
      expect(peer.last('snapshot')).toMatchObject({ botSeats: 4 })
      expect(botSeatsIn(peer)).toEqual([1, 2, 3, 4])
    })
  })

  it('never debits the chip ledger for a bot buy-in', async () => {
    const { hub, ledger } = withBots()
    await sitAndStart(hub)
    // A bot has no account and no bankroll. Every entry must belong to a real
    // player id, or bot chips are being minted against somebody's balance.
    for (const entry of ledger.entries) {
      expect(entry.playerId.startsWith('bot:')).toBe(false)
    }
    expect(ledger.entries.filter((entry) => entry.reason === 'table_buy_in').length).toBe(1)
  })

  it('does not take a seat a person is waiting for', async () => {
    const { hub } = withBots()
    const alice = await connectAndEnter(hub, 'alice', 'Alice')
    const bob = await connectAndEnter(hub, 'bob', 'Bob')
    await alice.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'a',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await bob.connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'b',
        command: { kind: 'sit', seat: 1, buyIn: 50_000 },
      }),
    )
    const seats = seatsIn(bob.peer)
    expect(seats[1]?.playerId).toBe(BOB)
  })

  /**
   * The question this answers is "can somebody actually sit down and play a
   * hand against the bots", and until now nothing asserted it. There were tests
   * that bots take seats, that bots act, that buy-ins hit the ledger - each one
   * a slice, none of them the loop. A table can pass all three and still wedge
   * on the turn, or pay a pot to nobody.
   */
  it('plays a whole hand against the bots and pays the pot out', async () => {
    vi.useFakeTimers()
    const { hub } = withBots()
    const { peer, connection } = await sitAndStart(hub)

    function view() {
      const snapshot = peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      return snapshot.view
    }

    const seated = () => view().seats.filter((seat) => seat.playerId !== null)
    // Everything anybody has, wherever it currently sits.
    //
    // `pot` already counts the chips sitting in front of players on the current
    // street - `betStreet` is a display copy of money the pot has, not money
    // beside it. Adding both double-counts, which is how this first read 750
    // chips high: exactly one small blind plus one big blind.
    const chipsInPlay = () => view().pot + seated().reduce((total, seat) => total + seat.stack, 0)

    const opened = chipsInPlay()
    expect(view().phase).toBe('hand')
    expect(seated().length).toBeGreaterThan(1)

    // Play it out. Alice takes the cheapest line that stays in the hand, so the
    // hand runs the full four streets to a showdown rather than ending on a
    // fold two actions in.
    let actions = 0
    for (let step = 0; step < 400 && view().phase === 'hand'; step += 1) {
      const current = view()
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        const legal = current.legal
        const kind = legal.check.enabled ? 'check' : legal.call.enabled ? 'call' : 'fold'
        await connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `act-${step}`,
            command: { kind: 'act', action: { kind } },
          }),
        )
        actions += 1
        continue
      }
      // Otherwise it is a bot's turn, and a bot acts on a timer.
      await vi.advanceTimersByTimeAsync(2_000)
    }

    // The hand ended, rather than the loop running out of patience on a table
    // waiting for an actor that never moves. Checking and calling down reaches
    // the river, so this is a real showdown and not a hand that folded out.
    expect(view().phase).toBe('between')
    expect(view().street).toBe('river')
    expect(actions).toBeGreaterThan(0)

    // Nothing was minted and nothing evaporated. The pot is settled and every
    // chip that was on the table at the deal is still on it, in somebody's
    // stack. This is the assertion that a payout bug cannot survive.
    expect(view().pot).toBe(0)
    expect(chipsInPlay()).toBe(opened)

    // Somebody won it: at least one stack moved.
    const movedSeats = seated().filter((seat) => seat.stack !== 50_000)
    expect(movedSeats.length).toBeGreaterThan(0)
  })

  it('tells the client the table fills with bots, so one person can deal', async () => {
    // The deadlock this closes: bots take their seats on the deal, and the
    // client would only offer a deal once two seats were taken. Sitting down
    // alone at a bot table, there was no button to press and nothing coming.
    const { hub } = withBots()
    const { peer } = await sitAndStart(hub)
    expect(peer.last('snapshot')).toMatchObject({ botSeats: 5 })

    const { hub: quiet } = setup()
    const solo = await sitAndStart(quiet)
    expect(solo.peer.last('snapshot')).toMatchObject({ botSeats: 0 })
  })

  it('deals the next hand instead of stopping after one', async () => {
    // River dealt exactly one hand and then sat there. The room had always
    // announced a countdown when a hand ended - a `between` event carrying
    // countdownMs - and nothing anywhere acted on it, so the number was
    // published, displayed, and obeyed by nobody.
    vi.useFakeTimers()
    const { hub } = withBots()
    const { peer, connection } = await sitAndStart(hub)

    function view() {
      const snapshot = peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      return snapshot.view
    }

    expect(view().handNumber).toBe(1)

    // Play the first hand out the cheap way.
    for (let step = 0; step < 400 && view().phase === 'hand'; step += 1) {
      const current = view()
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        const kind = current.legal.check.enabled ? 'check' : 'call'
        await connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `n-${step}`,
            command: { kind: 'act', action: { kind } },
          }),
        )
        continue
      }
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(view().phase).toBe('between')

    // The countdown the room announced actually runs now. Step the clock
    // rather than jumping it once: seed finalisation runs on every broadcast at
    // seedCollectionMs 0, and the number of queue turns between nextHandTimer
    // firing and startHand landing varies with it. A single advance passed five
    // times in six. Stepping still fails if the hand never starts - it only
    // stops the test caring how many turns that took.
    //
    // How long to wait is the room's to say. The gap was a flat 3000ms; after a
    // showdown it now also covers the showdown being told, one hand at a time,
    // and this hand checks down to one.
    const announced = peer.messages.flatMap((message) =>
      message.kind === 'snapshot'
        ? message.events.flatMap((event) => (event.kind === 'between' ? [event.countdownMs] : []))
        : [],
    )
    const countdown = announced[announced.length - 1] ?? 3_000
    expect(countdown).toBeGreaterThan(3_000)
    for (let step = 0; step < (countdown + 5_000) / 500 && view().handNumber === 1; step += 1) {
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(view().handNumber).toBeGreaterThan(1)
    expect(view().phase).toBe('hand')
  })

  it('never returns a bot its stack when the server goes down', async () => {
    const { hub, ledger } = withBots()
    await sitAndStart(hub)
    await hub.settleAllTables()
    // Bots buy in without touching the ledger, so crediting one on the way out
    // mints chips against an id that owns no account.
    for (const entry of ledger.entries) {
      expect(entry.playerId.startsWith('bot:')).toBe(false)
    }
  })

  it('has the bots look at their cards, on their own time', async () => {
    // The client used to lift every seat's cards itself on the deal, bots included, all
    // within a second and a half. The bots now look when the server says they do - some
    // soon after the deal, the rest when the action reaches them - and every client sees
    // the same looks at the same moments.
    vi.useFakeTimers()
    const { hub } = withBots()
    const { peer } = await sitAndStart(hub)
    await vi.advanceTimersByTimeAsync(8_000)
    const looked = peer.messages.filter(
      (message) =>
        message.kind === 'social' &&
        message.event.kind === 'peeked' &&
        message.event.playerId.startsWith('bot:'),
    )
    expect(looked.length).toBeGreaterThan(0)
  })

  describe('decisions worked out off the main thread', () => {
    // Bots that only check or call, so every hand reaches the river.
    const passive: BotPolicy = {
      id: 'passive-test',
      version: 1,
      decide(context) {
        const { legal } = context.observation
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: context.observation.version,
          decision: legal.check ? { kind: 'check' } : { kind: 'call' },
          fallbackReason: null,
        }
      },
    }
    function thinkerAnswering(answer: (request: ThinkRequest) => Promise<TurnAction | null>) {
      const requests: ThinkRequest[] = []
      const thinker: BotRiverThinker = {
        wants: (view, playerId) =>
          view.street === 'river' && view.currentActor?.playerId === playerId,
        think: (request) => {
          requests.push(request)
          return answer(request)
        },
        close: async () => {},
      }
      return { thinker, requests }
    }
    async function playOut(thinker: BotRiverThinker) {
      const { hub } = setup(
        30_000,
        0,
        undefined,
        undefined,
        undefined,
        5,
        undefined,
        passive,
        undefined,
        undefined,
        undefined,
        undefined,
        thinker,
      )
      const { peer, connection } = await sitAndStart(hub)
      const view = () => {
        const snapshot = peer.last('snapshot')
        if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
        return snapshot.view
      }
      for (let step = 0; step < 400 && view().phase === 'hand'; step += 1) {
        const current = view()
        if (current.currentActor?.playerId === ALICE && current.legal !== null) {
          const kind = current.legal.check.enabled ? 'check' : 'call'
          await connection.receive(
            JSON.stringify({
              kind: 'command',
              requestId: `act-${step}`,
              command: { kind: 'act', action: { kind } },
            }),
          )
          continue
        }
        await vi.advanceTimersByTimeAsync(1_000)
      }
      const botMoves = peer.messages.flatMap((message) =>
        message.kind === 'snapshot'
          ? message.events.filter((event) => event.kind === 'acted' && event.playerId !== ALICE)
          : [],
      )
      return { phase: view().phase, botMoves }
    }

    it('plays the thinker answer when it is back in time', async () => {
      vi.useFakeTimers()
      const { thinker, requests } = thinkerAnswering(async () => ({ kind: 'allIn' }))
      const { phase, botMoves } = await playOut(thinker)
      expect(phase).toBe('between')
      expect(requests.length).toBeGreaterThan(0)
      expect(requests[0]?.view.street).toBe('river')
      // It crosses to a worker thread as plain data.
      expect(() => structuredClone(requests[0])).not.toThrow()
      expect(
        botMoves.some((event) => event.kind === 'acted' && event.action.kind === 'allIn'),
      ).toBe(true)
    })

    it('plays the quick decision when the thinker has no answer', async () => {
      vi.useFakeTimers()
      const { thinker, requests } = thinkerAnswering(async () => null)
      const { phase, botMoves } = await playOut(thinker)
      expect(phase).toBe('between')
      expect(requests.length).toBeGreaterThan(0)
      expect(
        botMoves.some((event) => event.kind === 'acted' && event.action.kind === 'allIn'),
      ).toBe(false)
    })

    it('waits for a late answer rather than playing before it', async () => {
      vi.useFakeTimers()
      const { thinker } = thinkerAnswering(
        () => new Promise((resolve) => setTimeout(() => resolve({ kind: 'allIn' }), 5_000)),
      )
      const { phase, botMoves } = await playOut(thinker)
      expect(phase).toBe('between')
      expect(
        botMoves.some((event) => event.kind === 'acted' && event.action.kind === 'allIn'),
      ).toBe(true)
    })
  })

  it('acts for a bot when the turn reaches it', async () => {
    vi.useFakeTimers()
    const { hub } = withBots()
    const { peer } = await sitAndStart(hub)
    const before = peer.messages.length
    await vi.advanceTimersByTimeAsync(8_000)
    // A bot that never acts is a table that never moves - the person would sit
    // watching the clock run down on somebody else's turn.
    expect(peer.messages.length).toBeGreaterThan(before)
  })

  it('routes a live bot turn through an injected policy and server-only trace', async () => {
    vi.useFakeTimers()
    let calls = 0
    const traces: BotDecisionTrace[] = []
    const policy: BotPolicy = {
      id: 'trace-test',
      version: 1,
      decide(context) {
        calls += 1
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: context.observation.version,
          decision: { kind: 'fold' },
          fallbackReason: null,
        }
      },
    }
    const { hub } = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      5,
      undefined,
      policy,
      (trace) => traces.push(trace),
    )
    const { peer } = await sitAndStart(hub)
    await vi.advanceTimersByTimeAsync(8_000)
    expect(calls).toBeGreaterThan(0)
    expect(traces[0]).toMatchObject({
      policyId: 'trace-test',
      policyVersion: 1,
      observationVersion: 1,
      fallbackReason: null,
    })
    expect(JSON.stringify(peer.messages)).not.toContain('trace-test')
  })

  it('gives each bot its own exact-once session read of a human after a settled hand', async () => {
    vi.useFakeTimers()
    const observations: BotObservationV1[] = []
    const policy: BotPolicy = {
      id: 'memory-observer',
      version: 1,
      decide(context) {
        observations.push(context.observation)
        const legal = context.observation.legal
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: 1,
          decision: legal.check
            ? { kind: 'check' }
            : legal.call.enabled
              ? { kind: 'call' }
              : { kind: 'fold' },
          fallbackReason: null,
        }
      },
    }
    const { hub } = setup(30_000, 0, undefined, undefined, undefined, 1, undefined, policy)
    const { peer, connection } = await sitAndStart(hub)
    const view = () => {
      const snapshot = peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      return snapshot.view
    }

    for (let step = 0; step < 400 && view().phase === 'hand'; step += 1) {
      const current = view()
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        const kind = current.legal.check.enabled ? 'check' : 'call'
        await connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `memory-first-${step}`,
            command: { kind: 'act', action: { kind } },
          }),
        )
      } else {
        await vi.advanceTimersByTimeAsync(2_000)
      }
    }
    expect(view().phase).toBe('between')

    let remembered: BotObservationV1 | undefined
    for (let step = 0; step < 500 && remembered === undefined; step += 1) {
      const current = view()
      if (
        current.phase === 'hand' &&
        current.currentActor?.playerId === ALICE &&
        current.legal !== null
      ) {
        const kind = current.legal.check.enabled ? 'check' : 'call'
        await connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `memory-second-${step}`,
            command: { kind: 'act', action: { kind } },
          }),
        )
      } else {
        await vi.advanceTimersByTimeAsync(1_000)
      }
      remembered = observations.find(
        (observation) =>
          observation.handNumber === 2 &&
          observation.opponents.some(
            (opponent) => opponent.playerId === ALICE && opponent.sampleCount > 0,
          ),
      )
    }
    const aliceRead = remembered?.opponents.find((opponent) => opponent.playerId === ALICE)
    expect(aliceRead?.sampleCount).toBeCloseTo(1, 6)
    expect(aliceRead?.confidence).toBeGreaterThan(0)
    // The richer public statistics travel with it, for a policy that reads them.
    const aliceStats = remembered?.opponentStats?.find((entry) => entry.playerId === ALICE)
    expect(aliceStats?.hands).toBeCloseTo(1, 6)
    expect(JSON.stringify(peer.messages)).not.toContain('aggressionFrequency')
    expect(JSON.stringify(peer.messages)).not.toContain('memory-observer')
  })

  it('restores a signed-in human read for the same named bot in a new hub', async () => {
    vi.useFakeTimers()
    const rows = new Map<string, BotOpponentObservation>()
    let appendCalls = 0
    const store: BotOpponentStore = {
      async append(observation) {
        appendCalls += 1
        rows.set(`${observation.botId}:${observation.playerId}:${observation.handKey}`, observation)
        if (appendCalls === 1) throw new Error('reply lost after commit')
      },
      async load(botId, playerId) {
        let model: OpponentModelStateV1 | null = null
        for (const row of rows.values()) {
          if (row.botId === botId && row.playerId === playerId) {
            model = updateOpponentModel(
              model,
              row.evidence,
              row.observedAtMs,
              DEFAULT_OPPONENT_MODEL_TUNING,
            )
          }
        }
        return model
      },
    }
    const observations: BotObservationV1[] = []
    const policy: BotPolicy = {
      id: 'persisted-read-test',
      version: 1,
      decide(context) {
        observations.push(context.observation)
        const legal = context.observation.legal
        return {
          policyId: this.id,
          policyVersion: this.version,
          observationVersion: 1,
          decision: legal.check
            ? { kind: 'check' }
            : legal.call.enabled
              ? { kind: 'call' }
              : { kind: 'fold' },
          fallbackReason: null,
        }
      },
    }
    const firstHub = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      policy,
      undefined,
      store,
    ).hub
    const first = await sitAndStart(firstHub, 'aliceSaved')
    const view = (peer: TestPeer) => {
      const snapshot = peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      return snapshot.view
    }
    for (let step = 0; step < 400 && view(first.peer).phase === 'hand'; step += 1) {
      const current = view(first.peer)
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        await first.connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `persist-first-${step}`,
            command: {
              kind: 'act',
              action: { kind: current.legal.check.enabled ? 'check' : 'call' },
            },
          }),
        )
      } else {
        await vi.advanceTimersByTimeAsync(2_000)
      }
    }
    expect(view(first.peer).phase).toBe('between')
    await vi.advanceTimersByTimeAsync(250)
    expect(rows.size).toBe(1)
    expect(appendCalls).toBe(2)
    vi.clearAllTimers()

    observations.length = 0
    const secondHub = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      policy,
      undefined,
      store,
    ).hub
    const second = await sitAndStart(secondHub, 'aliceSaved')
    for (let step = 0; step < 30 && observations.length === 0; step += 1) {
      const current = view(second.peer)
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        await second.connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `persist-second-${step}`,
            command: {
              kind: 'act',
              action: { kind: current.legal.check.enabled ? 'check' : 'call' },
            },
          }),
        )
      } else {
        await vi.advanceTimersByTimeAsync(2_000)
      }
    }
    expect(
      observations[0]?.opponents.find((opponent) => opponent.playerId === ALICE)?.sampleCount,
    ).toBeCloseTo(1, 6)
    expect(JSON.stringify(second.peer.messages)).not.toContain('aggressionFrequency')
  })

  it('does not load anonymous history and keeps dealing after a storage failure', async () => {
    vi.useFakeTimers()
    const store: BotOpponentStore = {
      append: vi.fn(async () => undefined),
      load: vi.fn(async () => {
        throw new Error('storage unavailable')
      }),
    }
    const onError = vi.fn()
    const anonymousHub = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      store,
      onError,
    ).hub
    const anonymous = await sitAndStart(anonymousHub)
    expect(anonymous.peer.last('snapshot')?.kind).toBe('snapshot')
    expect(store.load).not.toHaveBeenCalled()
    const anonymousView = () => {
      const snapshot = anonymous.peer.last('snapshot')
      if (snapshot?.kind !== 'snapshot') throw new Error('expected a snapshot')
      return snapshot.view
    }
    for (let step = 0; step < 400 && anonymousView().phase === 'hand'; step += 1) {
      const current = anonymousView()
      if (current.currentActor?.playerId === ALICE && current.legal !== null) {
        await anonymous.connection.receive(
          JSON.stringify({
            kind: 'command',
            requestId: `anonymous-${step}`,
            command: {
              kind: 'act',
              action: { kind: current.legal.check.enabled ? 'check' : 'call' },
            },
          }),
        )
      } else {
        await vi.advanceTimersByTimeAsync(2_000)
      }
    }
    expect(anonymousView().phase).toBe('between')
    expect(store.append).not.toHaveBeenCalled()
    vi.clearAllTimers()

    const signedHub = setup(
      30_000,
      0,
      undefined,
      undefined,
      undefined,
      1,
      undefined,
      undefined,
      undefined,
      store,
      onError,
    ).hub
    const signed = await sitAndStart(signedHub, 'aliceSaved')
    expect(signed.peer.last('snapshot')?.kind).toBe('snapshot')
    expect(store.load).toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('bot opponent memory: load failed', expect.any(Error))
  })
})
