import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPlayer } from './auth.js'
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

function setup(reconnectGraceMs = 30_000) {
  const ledger = new MemoryLedger()
  const players: Record<string, AuthenticatedPlayer> = {
    alice: { playerId: ALICE, anonymous: true },
    aliceSaved: { playerId: ALICE, anonymous: false },
    bob: { playerId: BOB, anonymous: false },
  }
  const hub = new RoomHub({
    ledger,
    verifyToken: async (token) => {
      const player = players[token]
      if (player === undefined) throw new Error('invalid token')
      return player
    },
    createRoom: (roomId) =>
      new Room(roomId, defaultRoomConfig({ seed: roomId, inviteCode: 'RIVER2', reconnectGraceMs })),
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
})

describe('room hub', () => {
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
