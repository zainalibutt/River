import type { EconomyConfig } from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPlayer } from './auth.js'
import type { LedgerRow, SupabaseEconomy } from './economy-service.js'
import type { Ledger, LedgerEntry } from './ledger.js'
import { defaultRoomConfig, Room, stakeForId, turnBudgetsForPreset } from './room.js'
import type { ClientPeer, RoomCreationSettings, ServerMessage } from './transport.js'
import { parseClientMessage, RoomHub } from './transport.js'

const ALICE = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const BOB = '78047f44-a536-4861-9d8f-784d77bda917'
const DEV = 'c1f9a4de-1f0b-4d4a-8a2c-2b6f0e5a7d31'

class MemoryLedger implements Ledger {
  readonly balances = new Map([
    [ALICE, 100_000],
    [BOB, 100_000],
    [DEV, 100_000],
  ])
  readonly entries: LedgerEntry[] = []
  private readonly refs = new Map<string, LedgerEntry>()

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
  botSeats = 0,
) {
  const ledger = new MemoryLedger()
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
    }
    expect(parseClientMessage(JSON.stringify(enter))).toMatchObject(enter)
    for (const invalid of [
      { ...enter, maxSeats: 5 },
      { ...enter, stakeId: '1000-2000' },
      { ...enter, turnTimerPreset: 'instant' },
    ]) {
      expect(parseClientMessage(JSON.stringify(invalid))).toBeNull()
    }
  })
})

describe('room hub', () => {
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
    await vi.advanceTimersByTimeAsync(20)
    expect(alice.peer.last('snapshot')).toMatchObject({
      view: { phase: 'hand', turnDeadlineMs: expect.any(Number) },
      events: expect.arrayContaining([expect.objectContaining({ kind: 'timedOut' })]),
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
    })
    expect(settingsOfLast(creator)).toEqual({
      maxSeats: 6,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
    })

    const joiner = await enterWith(hub, 'bob', 'river-settings', 'basement', {
      maxSeats: 2,
      stakeId: '250-500',
      turnTimerPreset: 'standard',
    })
    expect(venueOfLast(joiner)).toBe('suite')
    expect(settingsOfLast(joiner)).toEqual(settingsOfLast(creator))
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

  async function sitAndStart(hub: RoomHub) {
    const { peer, connection } = await connectAndEnter(hub, 'alice', 'Alice')
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

    // The countdown the room announced actually runs now.
    await vi.advanceTimersByTimeAsync(3_500)
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
})
