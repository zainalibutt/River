import type { EconomyConfig } from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPlayer } from './auth.js'
import type { LedgerRow, SupabaseEconomy } from './economy-service.js'
import type { Ledger, LedgerEntry } from './ledger.js'
import { defaultRoomConfig, Room } from './room.js'
import type { ClientPeer, ServerMessage } from './transport.js'
import { parseClientMessage, RoomHub } from './transport.js'

const ALICE = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const BOB = '78047f44-a536-4861-9d8f-784d77bda917'

class MemoryLedger implements Ledger {
  readonly balances = new Map([
    [ALICE, 100_000],
    [BOB, 100_000],
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
) {
  const ledger = new MemoryLedger()
  const players: Record<string, AuthenticatedPlayer> = {
    alice: { playerId: ALICE, anonymous: true },
    aliceSaved: { playerId: ALICE, anonymous: false },
    bob: { playerId: BOB, anonymous: false },
  }
  const hub = new RoomHub({
    ledger,
    ...(economy === undefined ? {} : { economy }),
    verifyToken: async (token) => {
      const player = players[token]
      if (player === undefined) throw new Error('invalid token')
      return player
    },
    createRoom: (roomId) =>
      new Room(
        roomId,
        defaultRoomConfig({
          seed: roomId,
          inviteCode: 'RIVER2',
          reconnectGraceMs,
          seedCollectionMs,
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
    signupBankroll: 100_000,
    rescueFloor: 25_000,
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
