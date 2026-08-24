import { randomBytes } from 'node:crypto'
import type { TurnAction } from '@river/engine'
import type { AuthenticatedPlayer, TokenVerifier } from './auth.js'
import { isFairnessSeed } from './fairness.js'
import type { Ledger } from './ledger.js'
import type { RoomCommand, RoomEvent, RoomResult, RoomView } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'

export interface ClientPeer {
  send(message: string): void
  close(code: number, reason: string): void
}

export type ClientRoomCommand =
  | { kind: 'sit'; seat: number; buyIn: number }
  | { kind: 'stand' }
  | { kind: 'leave' }
  | { kind: 'startHand' }
  | { kind: 'submitSeed'; seed: string }
  | { kind: 'kick'; targetPlayerId: string; reason: 'host' }
  | { kind: 'act'; action: TurnAction }
  | { kind: 'rebuy'; amount: number }

export type ClientMessage =
  | { kind: 'authenticate'; accessToken: string }
  | { kind: 'enter'; requestId: string; roomId: string; name: string; inviteCode?: string }
  | { kind: 'command'; requestId: string; command: ClientRoomCommand }
  | { kind: 'resync'; requestId: string }

export type ServerMessage =
  | { kind: 'authenticated'; playerId: string; anonymous: boolean }
  | {
      kind: 'snapshot'
      roomId: string
      requestId: string | null
      view: RoomView
      balance: number
      events: RoomEvent[]
    }
  | { kind: 'error'; requestId: string | null; code: string; message: string }

interface ConnectionState {
  peer: ClientPeer
  player: AuthenticatedPlayer | null
  roomId: string | null
  balance: number
  identityUpgraded: boolean
}

interface RoomState {
  room: Room
  connections: Set<ConnectionState>
  queue: Promise<void>
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>
  seedTimer: ReturnType<typeof setTimeout> | null
  turnTimer: ReturnType<typeof setTimeout> | null
}

export interface RoomHubOptions {
  verifyToken: TokenVerifier
  ledger: Ledger
  createRoom?: (roomId: string) => Room
}

const ROOM_ID = /^[a-z0-9][a-z0-9-]{2,31}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newInviteCode(): string {
  return Array.from(randomBytes(6), (byte) => INVITE_ALPHABET[byte & 31] ?? 'R').join('')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function turnAction(value: unknown): TurnAction | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'fold' || value.kind === 'check' || value.kind === 'call') {
    return { kind: value.kind }
  }
  if (value.kind === 'allIn') return { kind: 'allIn' }
  if (value.kind === 'raiseTo' && Number.isSafeInteger(value.to)) {
    return { kind: 'raiseTo', to: Number(value.to) }
  }
  return null
}

function roomCommand(value: unknown): ClientRoomCommand | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null
  switch (value.kind) {
    case 'sit':
      return Number.isSafeInteger(value.seat) && Number.isSafeInteger(value.buyIn)
        ? { kind: 'sit', seat: Number(value.seat), buyIn: Number(value.buyIn) }
        : null
    case 'stand':
    case 'leave':
    case 'startHand':
      return { kind: value.kind }
    case 'submitSeed':
      return typeof value.seed === 'string' && isFairnessSeed(value.seed)
        ? { kind: 'submitSeed', seed: value.seed.toLowerCase() }
        : null
    case 'kick':
      return typeof value.targetPlayerId === 'string' && value.reason === 'host'
        ? { kind: 'kick', targetPlayerId: value.targetPlayerId, reason: value.reason }
        : null
    case 'act': {
      const action = turnAction(value.action)
      return action === null ? null : { kind: 'act', action }
    }
    case 'rebuy':
      return Number.isSafeInteger(value.amount)
        ? { kind: 'rebuy', amount: Number(value.amount) }
        : null
    default:
      return null
  }
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isObject(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'authenticate' && typeof value.accessToken === 'string') {
    return { kind: 'authenticate', accessToken: value.accessToken }
  }
  if (!REQUEST_ID.test(String(value.requestId ?? ''))) return null
  const requestId = String(value.requestId)
  if (
    value.kind === 'enter' &&
    typeof value.roomId === 'string' &&
    typeof value.name === 'string'
  ) {
    const inviteCode = typeof value.inviteCode === 'string' ? value.inviteCode : undefined
    return {
      kind: 'enter',
      requestId,
      roomId: value.roomId,
      name: value.name,
      ...(inviteCode === undefined ? {} : { inviteCode }),
    }
  }
  if (value.kind === 'command') {
    const command = roomCommand(value.command)
    return command === null ? null : { kind: 'command', requestId, command }
  }
  if (value.kind === 'resync') return { kind: 'resync', requestId }
  return null
}

export class RoomHub {
  private readonly verifyToken: TokenVerifier
  private readonly ledger: Ledger
  private readonly createRoom: (roomId: string) => Room
  private readonly rooms = new Map<string, RoomState>()
  private readonly activePlayers = new Map<string, ConnectionState>()
  private readonly completed = new Map<string, ServerMessage>()

  constructor(options: RoomHubOptions) {
    this.verifyToken = options.verifyToken
    this.ledger = options.ledger
    this.createRoom =
      options.createRoom ??
      ((roomId) =>
        new Room(
          roomId,
          defaultRoomConfig({ seed: `river:${roomId}`, inviteCode: newInviteCode() }),
        ))
  }

  connect(peer: ClientPeer): {
    receive: (raw: string) => Promise<void>
    close: () => Promise<void>
  } {
    const connection: ConnectionState = {
      peer,
      player: null,
      roomId: null,
      balance: 0,
      identityUpgraded: false,
    }
    return {
      receive: (raw) => this.receive(connection, raw),
      close: () => this.disconnect(connection),
    }
  }

  private async receive(connection: ConnectionState, raw: string): Promise<void> {
    const message = parseClientMessage(raw)
    if (message === null) {
      this.error(connection, null, 'invalid_message', 'Invalid client message')
      return
    }
    if (message.kind === 'authenticate') {
      await this.authenticate(connection, message.accessToken)
      return
    }
    if (connection.player === null) {
      this.error(connection, message.requestId, 'unauthenticated', 'Authenticate before joining')
      return
    }
    if (message.kind === 'enter') {
      await this.enter(connection, message)
      return
    }
    if (connection.roomId === null) {
      this.error(connection, message.requestId, 'not_in_room', 'Join a room first')
      return
    }
    const room = this.rooms.get(connection.roomId)
    if (room === undefined) {
      this.error(connection, message.requestId, 'room_missing', 'Room no longer exists')
      return
    }
    await this.enqueue(room, async () => {
      if (message.kind === 'resync') {
        this.snapshot(connection, room, message.requestId, [])
      } else {
        await this.command(connection, room, message.requestId, message.command)
      }
    })
  }

  private async authenticate(connection: ConnectionState, accessToken: string): Promise<void> {
    if (connection.player !== null) {
      this.error(connection, null, 'already_authenticated', 'Connection is already authenticated')
      return
    }
    try {
      const player = await this.verifyToken(accessToken)
      const previous = this.activePlayers.get(player.playerId)
      if (previous !== undefined) {
        if (previous.roomId !== null) {
          const state = this.rooms.get(previous.roomId)
          if (state !== undefined) {
            this.snapshot(previous, state, null, [
              { kind: 'kicked', playerId: player.playerId, reason: 'duplicate-session' },
            ])
          }
        }
        previous.peer.close(4001, 'Replaced by a newer connection')
        await this.disconnect(previous)
        connection.identityUpgraded = previous.player?.anonymous === true && !player.anonymous
      }
      connection.player = player
      connection.balance = await this.ledger.balance(player.playerId)
      this.activePlayers.set(player.playerId, connection)
      this.send(connection, {
        kind: 'authenticated',
        playerId: player.playerId,
        anonymous: player.anonymous,
      })
    } catch {
      connection.peer.close(4003, 'Authentication failed')
    }
  }

  private async enter(
    connection: ConnectionState,
    message: Extract<ClientMessage, { kind: 'enter' }>,
  ): Promise<void> {
    const player = connection.player
    if (player === null) return
    if (!ROOM_ID.test(message.roomId) || message.name.trim().length === 0) {
      this.error(connection, message.requestId, 'invalid_room', 'Invalid room or player name')
      return
    }
    if (connection.roomId !== null && connection.roomId !== message.roomId) {
      this.error(connection, message.requestId, 'already_in_room', 'Leave the current room first')
      return
    }
    const exists = this.rooms.has(message.roomId)
    const room = this.room(message.roomId)
    await this.enqueue(room, async () => {
      if (
        exists &&
        message.inviteCode?.trim().toUpperCase() !== room.room.config.inviteCode.toUpperCase()
      ) {
        this.error(
          connection,
          message.requestId,
          'join_rejected',
          'That code does not match a table.',
        )
        return
      }
      let events: RoomEvent[] = []
      const reconnect = room.room.submit({ kind: 'reconnect', playerId: player.playerId })
      if (reconnect.ok) {
        events = reconnect.events
      } else {
        const result = room.room.submit({
          kind: 'join',
          playerId: player.playerId,
          name: message.name.trim(),
          ...(message.inviteCode === undefined ? {} : { inviteCode: message.inviteCode }),
        })
        if (!result.ok) {
          this.error(
            connection,
            message.requestId,
            'join_rejected',
            result.events[0]?.kind === 'rejected' ? result.events[0].message : 'Join rejected',
          )
          return
        }
        events = result.events
      }
      if (connection.identityUpgraded) {
        events = [...events, { kind: 'identityUpgraded', playerId: player.playerId }]
        connection.identityUpgraded = false
      }
      connection.roomId = message.roomId
      room.connections.add(connection)
      const reconnectTimer = room.reconnectTimers.get(player.playerId)
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        room.reconnectTimers.delete(player.playerId)
      }
      this.broadcast(room, message.requestId, events, connection)
    })
  }

  private async command(
    connection: ConnectionState,
    state: RoomState,
    requestId: string,
    command: ClientRoomCommand,
  ): Promise<void> {
    const player = connection.player
    if (player === null || connection.roomId === null) return
    const cacheKey = `${player.playerId}:${requestId}`
    const cached = this.completed.get(cacheKey)
    if (cached !== undefined) {
      this.send(connection, cached)
      return
    }
    const serverCommand = this.withPlayer(command, player.playerId)
    let result: RoomResult
    if (command.kind === 'sit' || command.kind === 'rebuy') {
      result = await this.debitThenApply(connection, state, requestId, serverCommand, command)
    } else if (command.kind === 'stand' || command.kind === 'leave') {
      result = await this.applyThenCredit(connection, state, requestId, serverCommand)
    } else if (command.kind === 'kick') {
      if (serverCommand.kind !== 'kick') throw new Error('kick command lost its server identity')
      result = await this.kickThenCredit(connection, state, requestId, serverCommand)
    } else {
      if (
        command.kind === 'startHand' &&
        state.room.viewFor(player.playerId).handNumber === 0 &&
        state.room.config.hostPlayerId !== player.playerId
      ) {
        result = {
          ok: false,
          events: [
            {
              kind: 'rejected',
              playerId: player.playerId,
              message: 'only the host can deal first',
            },
          ],
        }
      } else {
        result = state.room.submit(serverCommand)
      }
    }
    if (!result.ok) {
      const rejected = result.events.find((event) => event.kind === 'rejected')
      const message: ServerMessage = {
        kind: 'error',
        requestId,
        code: 'command_rejected',
        message: rejected?.message ?? 'Command rejected',
      }
      this.completed.set(cacheKey, message)
      this.send(connection, message)
      return
    }
    this.broadcast(state, requestId, result.events, connection)
    if (result.events.some((event) => event.kind === 'handStarted')) {
      this.clearSeedFinalization(state)
    } else if (result.events.some((event) => event.kind === 'seedCommitted')) {
      this.scheduleSeedFinalization(state)
    }
    const reply: ServerMessage = {
      kind: 'snapshot',
      roomId: connection.roomId,
      requestId,
      view: state.room.viewFor(player.playerId),
      balance: connection.balance,
      events: result.events,
    }
    this.completed.set(cacheKey, reply)
    if (this.completed.size > 10_000) {
      const oldest = this.completed.keys().next().value
      if (oldest !== undefined) this.completed.delete(oldest)
    }
    if (command.kind === 'leave') {
      state.connections.delete(connection)
      connection.roomId = null
    }
  }

  private async kickThenCredit(
    connection: ConnectionState,
    state: RoomState,
    requestId: string,
    serverCommand: Extract<RoomCommand, { kind: 'kick' }>,
  ): Promise<RoomResult> {
    const targetSeat = state.room
      .viewFor(serverCommand.byPlayerId)
      .seats.find((seat) => seat.playerId === serverCommand.targetPlayerId)
    const stack = targetSeat?.stack ?? 0
    if (stack > 0) {
      try {
        await this.ledger.apply({
          playerId: serverCommand.targetPlayerId,
          delta: stack,
          reason: 'table_kick_cash_out',
          ref: `${connection.roomId}:${requestId}:credit`,
        })
      } catch (error) {
        return {
          ok: false,
          events: [
            {
              kind: 'rejected',
              playerId: serverCommand.byPlayerId,
              message: error instanceof Error ? error.message : 'Ledger credit failed',
            },
          ],
        }
      }
    }
    const result = state.room.submit(serverCommand)
    if (!result.ok && stack > 0) {
      await this.ledger.apply({
        playerId: serverCommand.targetPlayerId,
        delta: -stack,
        reason: 'table_kick_cash_out_refund',
        ref: `${connection.roomId}:${requestId}:refund`,
      })
    }
    return result
  }

  private async debitThenApply(
    connection: ConnectionState,
    state: RoomState,
    requestId: string,
    serverCommand: RoomCommand,
    command: Extract<ClientRoomCommand, { kind: 'sit' | 'rebuy' }>,
  ) {
    const player = connection.player
    if (player === null || connection.roomId === null) throw new Error('missing player context')
    const amount = command.kind === 'sit' ? command.buyIn : command.amount
    const reason = command.kind === 'sit' ? 'table_buy_in' : 'table_rebuy'
    try {
      connection.balance = await this.ledger.apply({
        playerId: player.playerId,
        delta: -amount,
        reason,
        ref: `${connection.roomId}:${requestId}:debit`,
      })
    } catch (error) {
      return {
        ok: false,
        events: [
          {
            kind: 'rejected' as const,
            playerId: player.playerId,
            message: error instanceof Error ? error.message : 'Ledger debit failed',
          },
        ],
      }
    }
    const result = state.room.submit(serverCommand)
    if (!result.ok) {
      connection.balance = await this.ledger.apply({
        playerId: player.playerId,
        delta: amount,
        reason: `${reason}_refund`,
        ref: `${connection.roomId}:${requestId}:refund`,
      })
    }
    return result
  }

  private async applyThenCredit(
    connection: ConnectionState,
    state: RoomState,
    requestId: string,
    serverCommand: RoomCommand,
  ) {
    const player = connection.player
    if (player === null || connection.roomId === null) throw new Error('missing player context')
    const seat = state.room
      .viewFor(player.playerId)
      .seats.find((item) => item.playerId === player.playerId)
    const amount = seat?.stack ?? 0
    if (amount === 0) return state.room.submit(serverCommand)
    try {
      connection.balance = await this.ledger.apply({
        playerId: player.playerId,
        delta: amount,
        reason: serverCommand.kind === 'stand' ? 'table_cash_out' : 'table_leave',
        ref: `${connection.roomId}:${requestId}:credit`,
      })
    } catch (error) {
      return {
        ok: false,
        events: [
          {
            kind: 'rejected' as const,
            playerId: player.playerId,
            message: error instanceof Error ? error.message : 'Ledger credit failed',
          },
        ],
      }
    }
    const result = state.room.submit(serverCommand)
    if (!result.ok) {
      connection.balance = await this.ledger.apply({
        playerId: player.playerId,
        delta: -amount,
        reason: serverCommand.kind === 'stand' ? 'table_cash_out_refund' : 'table_leave_refund',
        ref: `${connection.roomId}:${requestId}:refund`,
      })
    }
    return result
  }

  private withPlayer(command: ClientRoomCommand, playerId: string): RoomCommand {
    switch (command.kind) {
      case 'sit':
        return { ...command, playerId }
      case 'stand':
      case 'leave':
        return { kind: command.kind, playerId }
      case 'startHand':
        return command
      case 'submitSeed':
        return { ...command, playerId }
      case 'kick':
        return { ...command, byPlayerId: playerId }
      case 'act':
        return { ...command, playerId }
      case 'rebuy':
        return { ...command, playerId }
    }
  }

  private async disconnect(connection: ConnectionState): Promise<void> {
    const player = connection.player
    if (player === null) return
    if (this.activePlayers.get(player.playerId) === connection) {
      this.activePlayers.delete(player.playerId)
    }
    if (connection.roomId === null) return
    const state = this.rooms.get(connection.roomId)
    if (state === undefined) return
    await this.enqueue(state, async () => {
      state.connections.delete(connection)
      const result = state.room.submit({ kind: 'disconnect', playerId: player.playerId })
      if (result.ok) {
        this.broadcast(state, null, result.events)
        this.scheduleReconnectExpiry(state, player.playerId)
      }
    })
  }

  private room(roomId: string): RoomState {
    const existing = this.rooms.get(roomId)
    if (existing !== undefined) return existing
    const created: RoomState = {
      room: this.createRoom(roomId),
      connections: new Set(),
      queue: Promise.resolve(),
      reconnectTimers: new Map(),
      seedTimer: null,
      turnTimer: null,
    }
    this.rooms.set(roomId, created)
    return created
  }

  private scheduleReconnectExpiry(state: RoomState, playerId: string): void {
    const existing = state.reconnectTimers.get(playerId)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      void this.enqueue(state, async () => {
        const view = state.room.viewFor(playerId)
        const seat = view.seats.find((item) => item.playerId === playerId)
        const stack = seat?.stack ?? 0
        if (stack > 0) {
          await this.ledger.apply({
            playerId,
            delta: stack,
            reason: 'table_reconnect_expiry_cash_out',
            ref: `${state.room.id}:reconnect-expiry:${playerId}:${view.handNumber}`,
          })
        }
        const result = state.room.submit({ kind: 'expireReconnect', playerId })
        if (!result.ok && stack > 0) {
          await this.ledger.apply({
            playerId,
            delta: -stack,
            reason: 'table_reconnect_expiry_cash_out_refund',
            ref: `${state.room.id}:reconnect-expiry-refund:${playerId}:${view.handNumber}`,
          })
        }
        if (result.ok) this.broadcast(state, null, result.events)
        state.reconnectTimers.delete(playerId)
      })
    }, state.room.config.reconnectGraceMs)
    state.reconnectTimers.set(playerId, timer)
  }

  private scheduleSeedFinalization(state: RoomState): void {
    this.clearSeedFinalization(state)
    state.seedTimer = setTimeout(() => {
      void this.enqueue(state, async () => {
        const result = state.room.submit({ kind: 'finalizeSeeds' })
        if (result.ok) this.broadcast(state, null, result.events)
        state.seedTimer = null
      })
    }, state.room.config.seedCollectionMs)
  }

  private scheduleTurnTimeout(state: RoomState): void {
    this.clearTurnTimeout(state)
    const deadline = state.room.viewFor('').turnDeadlineMs
    if (deadline === null) return
    state.turnTimer = setTimeout(
      () => {
        void this.enqueue(state, async () => {
          state.turnTimer = null
          const result = state.room.submit({ kind: 'timeoutTurn' })
          if (result.ok) {
            this.broadcast(state, null, result.events)
          } else {
            this.scheduleTurnTimeout(state)
          }
        })
      },
      Math.max(0, deadline - state.room.config.nowMs()),
    )
  }

  private clearTurnTimeout(state: RoomState): void {
    if (state.turnTimer !== null) clearTimeout(state.turnTimer)
    state.turnTimer = null
  }

  private clearSeedFinalization(state: RoomState): void {
    if (state.seedTimer !== null) clearTimeout(state.seedTimer)
    state.seedTimer = null
  }

  private async enqueue(state: RoomState, task: () => Promise<void>): Promise<void> {
    const next = state.queue.then(task, task)
    state.queue = next.catch(() => undefined)
    await next
  }

  private broadcast(
    state: RoomState,
    requestId: string | null,
    events: RoomEvent[],
    requester?: ConnectionState,
  ): void {
    for (const connection of state.connections) {
      this.snapshot(connection, state, connection === requester ? requestId : null, events)
    }
    this.scheduleTurnTimeout(state)
  }

  private snapshot(
    connection: ConnectionState,
    state: RoomState,
    requestId: string | null,
    events: RoomEvent[],
  ): void {
    const player = connection.player
    if (player === null || connection.roomId === null) return
    this.send(connection, {
      kind: 'snapshot',
      roomId: connection.roomId,
      requestId,
      view: state.room.viewFor(player.playerId),
      balance: connection.balance,
      events,
    })
  }

  private error(
    connection: ConnectionState,
    requestId: string | null,
    code: string,
    message: string,
  ): void {
    this.send(connection, { kind: 'error', requestId, code, message })
  }

  private send(connection: ConnectionState, message: ServerMessage): void {
    connection.peer.send(JSON.stringify(message))
  }
}
