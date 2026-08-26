import { randomBytes } from 'node:crypto'
import type { BotPersonality, TableSummary, TurnAction } from '@river/engine'
import { tableStatus } from '@river/engine'
import type { AuthenticatedPlayer, TokenVerifier } from './auth.js'
import {
  actionFor,
  botPlayerId,
  botsForTable,
  botsWanted,
  emptySeatsIn,
  isBotPlayer,
  thinkingMs,
} from './bot-service.js'
import type { CosmeticOutcome, CosmeticStore, OwnedCosmetic } from './cosmetic-service.js'
import { buyCosmetic, wearCosmetic } from './cosmetic-service.js'
import type { EconomyDeps, GrantOutcome, SupabaseEconomy } from './economy-service.js'
import { claimDailyFor, claimRescueFor } from './economy-service.js'
import { isFairnessSeed } from './fairness.js'
import type { Ledger } from './ledger.js'
import type { Emote, RoomCommand, RoomEvent, RoomResult, RoomView, VenueId } from './protocol.js'
import { isVenueId } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'
import type {
  EquipOutcome,
  OwnedItem,
  PurchaseOutcome,
  TableItemStore,
} from './table-item-service.js'
import { equipItem, purchaseItem } from './table-item-service.js'

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

export type ClientSocialCommand =
  | { kind: 'chat'; text: string }
  | { kind: 'emote'; emote: Emote }
  | { kind: 'speaking'; speaking: boolean }

export type SocialEvent =
  | { kind: 'chat'; playerId: string; text: string; sentAtMs: number }
  | { kind: 'emote'; playerId: string; emote: Emote; sentAtMs: number }
  | { kind: 'emoteInterrupted'; playerId: string }
  | { kind: 'avatarVo'; playerId: string; trigger: 'allIn' | 'win' | 'loss'; sentAtMs: number }
  | { kind: 'speaking'; playerId: string; speaking: boolean }

export type ClientMessage =
  | { kind: 'authenticate'; accessToken: string }
  | {
      kind: 'enter'
      requestId: string
      roomId: string
      name: string
      inviteCode?: string
      /**
       * Which room to open a NEW table in. Ignored when the table already
       * exists, so joining can never move anyone who is already sitting there.
       */
      venueId?: VenueId
    }
  | { kind: 'command'; requestId: string; command: ClientRoomCommand }
  | { kind: 'social'; requestId: string; command: ClientSocialCommand }
  | { kind: 'resync'; requestId: string }
  | { kind: 'buyCosmetic'; requestId: string; cosmeticId: string }
  | { kind: 'wearCosmetic'; requestId: string; cosmeticId: string }
  | { kind: 'listTables'; requestId: string }
  | { kind: 'buyTableItem'; requestId: string; itemId: string }
  | { kind: 'equipTableItem'; requestId: string; itemId: string }
  | { kind: 'claimDaily'; requestId: string }
  | { kind: 'claimRescue'; requestId: string }

export type ServerMessage =
  | { kind: 'authenticated'; playerId: string; anonymous: boolean }
  | {
      kind: 'snapshot'
      roomId: string
      requestId: string | null
      view: RoomView
      balance: number
      ownedItems: OwnedItem[]
      ownedCosmetics: OwnedCosmetic[]
      events: RoomEvent[]
    }
  | { kind: 'social'; roomId: string; requestId: string | null; event: SocialEvent }
  | { kind: 'tables'; requestId: string; tables: TableSummary[] }
  | { kind: 'cosmetic'; requestId: string; outcome: CosmeticOutcome }
  | { kind: 'grant'; requestId: string; outcome: GrantOutcome }
  | { kind: 'tableItem'; requestId: string; outcome: PurchaseOutcome | EquipOutcome }
  | { kind: 'error'; requestId: string | null; code: string; message: string }

interface ConnectionState {
  peer: ClientPeer
  player: AuthenticatedPlayer | null
  roomId: string | null
  balance: number
  /**
   * Cached inventory. A snapshot is sent on every room event, so reading the
   * store there would put a database round trip in the hot path.
   */
  ownedItems: OwnedItem[]
  ownedCosmetics: OwnedCosmetic[]
  identityUpgraded: boolean
}

interface RoomState {
  room: Room
  connections: Set<ConnectionState>
  queue: Promise<void>
  reconnectTimers: Map<string, ReturnType<typeof setTimeout>>
  seedTimer: ReturnType<typeof setTimeout> | null
  turnTimer: ReturnType<typeof setTimeout> | null
  socialActions: Map<string, number[]>
  speakingPlayers: Set<string>
  activeEmotes: Set<string>
  botTimer: ReturnType<typeof setTimeout> | null
  /** Which character is in which bot seat, so a table keeps its cast. */
  botCast: Map<string, BotPersonality>
}

/**
 * Somewhere for a swallowed failure to go.
 *
 * Without one, a Supabase outage and a forged token close the socket with the
 * same code and leave nothing behind to tell them apart.
 */
export type HubErrorReporter = (context: string, error: unknown) => void

export interface RoomHubOptions {
  verifyToken: TokenVerifier
  ledger: Ledger
  onError?: HubErrorReporter
  /** Injectable so a test can make a bot's choices repeatable. */
  botRng?: () => number
  /**
   * How many seats bots may fill. Zero, the default, means a table is people
   * only - seating characters changes who acts and when, so it is opted into
   * rather than assumed.
   */
  botSeats?: number
  economy?: SupabaseEconomy
  tableItems?: TableItemStore
  cosmetics?: CosmeticStore
  createRoom?: (roomId: string, venueId?: VenueId) => Room
}

const DEFAULT_BOT_THINK_CAP = 4_000

const ROOM_ID = /^[a-z0-9][a-z0-9-]{2,31}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const EMOTES: readonly Emote[] = [
  'wave',
  'laugh',
  'facepalm',
  'fistPump',
  'throatSlit',
  'chipTrick',
  'dance',
  'confetti',
  'tableKnock',
]
const MAX_CHAT_LENGTH = 500

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

function socialCommand(value: unknown): ClientSocialCommand | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'chat' && typeof value.text === 'string') {
    const text = value.text.trim()
    return text.length > 0 && text.length <= MAX_CHAT_LENGTH ? { kind: 'chat', text } : null
  }
  if (
    value.kind === 'emote' &&
    typeof value.emote === 'string' &&
    EMOTES.includes(value.emote as Emote)
  ) {
    return { kind: 'emote', emote: value.emote as Emote }
  }
  if (value.kind === 'speaking' && typeof value.speaking === 'boolean') {
    return { kind: 'speaking', speaking: value.speaking }
  }
  return null
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
    const venueId = isVenueId(value.venueId) ? value.venueId : undefined
    return {
      kind: 'enter',
      requestId,
      roomId: value.roomId,
      name: value.name,
      ...(inviteCode === undefined ? {} : { inviteCode }),
      ...(venueId === undefined ? {} : { venueId }),
    }
  }
  if (value.kind === 'command') {
    const command = roomCommand(value.command)
    return command === null ? null : { kind: 'command', requestId, command }
  }
  if (value.kind === 'social') {
    const command = socialCommand(value.command)
    return command === null ? null : { kind: 'social', requestId, command }
  }
  if (value.kind === 'resync') return { kind: 'resync', requestId }
  if (
    (value.kind === 'buyTableItem' || value.kind === 'equipTableItem') &&
    typeof value.itemId === 'string' &&
    value.itemId.length > 0 &&
    value.itemId.length <= 64
  ) {
    return { kind: value.kind, requestId, itemId: value.itemId }
  }
  if (
    (value.kind === 'buyCosmetic' || value.kind === 'wearCosmetic') &&
    typeof value.cosmeticId === 'string' &&
    value.cosmeticId.length > 0 &&
    value.cosmeticId.length <= 64
  ) {
    return { kind: value.kind, requestId, cosmeticId: value.cosmeticId }
  }
  if (value.kind === 'listTables') return { kind: 'listTables', requestId }
  if (value.kind === 'claimDaily') return { kind: 'claimDaily', requestId }
  if (value.kind === 'claimRescue') return { kind: 'claimRescue', requestId }
  return null
}

export class RoomHub {
  private readonly verifyToken: TokenVerifier
  private readonly ledger: Ledger
  private readonly economy: SupabaseEconomy | null
  private readonly tableItems: TableItemStore | undefined
  private readonly cosmetics: CosmeticStore | undefined
  private readonly createRoom: (roomId: string, venueId?: VenueId) => Room
  private readonly rooms = new Map<string, RoomState>()
  private readonly activePlayers = new Map<string, ConnectionState>()
  private readonly completed = new Map<string, ServerMessage>()
  private readonly grantInFlight = new Set<string>()
  private readonly onError: HubErrorReporter
  /**
   * Bots draw from here rather than from the hand's fairness stream. A bot must
   * never be able to influence the deck, and sharing a source with the shuffle
   * would mean its bluff frequency moved the cards.
   */
  private readonly botRng: () => number
  private readonly botSeats: number

  constructor(options: RoomHubOptions) {
    this.verifyToken = options.verifyToken
    this.ledger = options.ledger
    this.onError = options.onError ?? ((): void => {})
    this.botRng = options.botRng ?? Math.random
    this.botSeats = Math.max(0, options.botSeats ?? 0)
    this.economy = options.economy ?? null
    this.tableItems = options.tableItems
    this.cosmetics = options.cosmetics
    this.createRoom =
      options.createRoom ??
      ((roomId, venueId) =>
        new Room(
          roomId,
          defaultRoomConfig({
            seed: `river:${roomId}`,
            inviteCode: newInviteCode(),
            ...(venueId === undefined ? {} : { venueId }),
          }),
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
      ownedItems: [],
      ownedCosmetics: [],
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
    if (message.kind === 'claimDaily' || message.kind === 'claimRescue') {
      await this.grant(connection, message)
      return
    }
    if (message.kind === 'listTables') {
      this.send(connection, {
        kind: 'tables',
        requestId: message.requestId,
        tables: this.tableSummaries(),
      })
      return
    }
    if (message.kind === 'buyCosmetic' || message.kind === 'wearCosmetic') {
      await this.cosmetic(connection, message)
      return
    }
    if (message.kind === 'buyTableItem' || message.kind === 'equipTableItem') {
      await this.tableItem(connection, message)
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
      } else if (message.kind === 'social') {
        await this.social(connection, room, message)
      } else if (message.kind === 'command') {
        await this.command(connection, room, message.requestId, message.command)
      }
    })
  }

  private async authenticate(connection: ConnectionState, accessToken: string): Promise<void> {
    if (connection.player !== null) {
      this.error(connection, null, 'already_authenticated', 'Connection is already authenticated')
      return
    }
    // Only the token check may report an authentication failure. Everything
    // after it is the session being opened, and a ledger that is down is not
    // a player who cannot prove who they are - telling them otherwise sends
    // them off to fix credentials that were never the problem.
    let player: AuthenticatedPlayer
    try {
      player = await this.verifyToken(accessToken)
    } catch (error) {
      this.onError('authenticate: token rejected', error)
      connection.peer.close(4003, 'Authentication failed')
      return
    }

    try {
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
    } catch (error) {
      this.onError('authenticate: session could not be opened', error)
      connection.player = null
      this.activePlayers.delete(player.playerId)
      connection.peer.close(4004, 'Could not open your session')
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
    const room = this.room(message.roomId, message.venueId)
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

  private async grant(
    connection: ConnectionState,
    message: Extract<ClientMessage, { kind: 'claimDaily' | 'claimRescue' }>,
  ): Promise<void> {
    const player = connection.player
    if (player === null) return
    if (this.economy === null) {
      this.error(connection, message.requestId, 'grant_unavailable', 'Grants are unavailable')
      return
    }
    if (this.grantInFlight.has(player.playerId)) {
      this.error(connection, message.requestId, 'grant_in_flight', 'A grant is already in progress')
      return
    }
    this.grantInFlight.add(player.playerId)
    try {
      const deps: EconomyDeps = {
        ...this.economy,
        seated: (playerId) => Promise.resolve(this.isSeated(playerId)),
      }
      const now = Date.now()
      const outcome =
        message.kind === 'claimDaily'
          ? await claimDailyFor(player.playerId, deps, now)
          : await claimRescueFor(player.playerId, deps, now)
      if (outcome.kind === 'granted') {
        connection.balance = outcome.balance
      }
      this.send(connection, { kind: 'grant', requestId: message.requestId, outcome })
    } catch {
      this.error(connection, message.requestId, 'grant_failed', 'Grant could not be processed')
    } finally {
      this.grantInFlight.delete(player.playerId)
    }
  }

  /**
   * Buy or equip a table item.
   *
   * Serialised per player like grants are: two purchases racing would read the
   * same balance and both pass the affordability check. The ledger ref would
   * still stop a double debit, but the second would fail confusingly rather
   * than being refused cleanly.
   */
  private async tableItem(
    connection: ConnectionState,
    message: Extract<ClientMessage, { kind: 'buyTableItem' | 'equipTableItem' }>,
  ): Promise<void> {
    const player = connection.player
    if (player === null) {
      this.error(connection, message.requestId, 'not_authenticated', 'Authenticate first')
      return
    }
    if (this.tableItems === undefined) {
      this.error(connection, message.requestId, 'items_unavailable', 'Table items are unavailable')
      return
    }
    if (this.grantInFlight.has(player.playerId)) {
      this.error(connection, message.requestId, 'grant_in_flight', 'A purchase is already running')
      return
    }
    this.grantInFlight.add(player.playerId)
    try {
      const store = this.tableItems
      const outcome =
        message.kind === 'buyTableItem'
          ? await purchaseItem(player.playerId, message.itemId, { ledger: this.ledger, store })
          : await equipItem(player.playerId, message.itemId, { store })
      if (outcome.kind === 'purchased') connection.balance = outcome.balance
      if (outcome.kind === 'purchased' || outcome.kind === 'equipped') {
        connection.ownedItems = await store.list(player.playerId)
      }
      this.send(connection, { kind: 'tableItem', requestId: message.requestId, outcome })
    } catch {
      this.error(connection, message.requestId, 'item_failed', 'That could not be processed')
    } finally {
      this.grantInFlight.delete(player.playerId)
    }
  }

  /**
   * Every live room as a lobby row.
   *
   * Rooms are in-memory per server instance, so this lists what this process
   * is hosting rather than a global directory. Invite codes are never included
   * - a lobby that leaked them would make a private table public.
   */
  private tableSummaries(): TableSummary[] {
    const summaries: TableSummary[] = []
    for (const [roomId, state] of this.rooms) {
      const view = state.room.viewFor('')
      const seatsTotal = view.seats.length
      const seatsTaken = view.seats.filter((seat) => seat.playerId !== null).length
      const config = state.room.config
      summaries.push({
        roomId,
        venueId: config.venueId,
        stakeId: config.stake.id,
        smallBlind: config.stake.smallBlind,
        bigBlind: config.stake.bigBlind,
        seatsTaken,
        seatsTotal,
        handNumber: view.handNumber,
        status: tableStatus(seatsTaken, seatsTotal, view.handNumber, view.phase === 'hand'),
        hasPassword: config.inviteCode.length > 0,
      })
    }
    return summaries
  }

  /** Buy or wear a cosmetic. Serialised per player, like every other spend. */
  private async cosmetic(
    connection: ConnectionState,
    message: Extract<ClientMessage, { kind: 'buyCosmetic' | 'wearCosmetic' }>,
  ): Promise<void> {
    const player = connection.player
    if (player === null) {
      this.error(connection, message.requestId, 'not_authenticated', 'Authenticate first')
      return
    }
    if (this.cosmetics === undefined) {
      this.error(
        connection,
        message.requestId,
        'cosmetics_unavailable',
        'Cosmetics are unavailable',
      )
      return
    }
    if (this.grantInFlight.has(player.playerId)) {
      this.error(connection, message.requestId, 'grant_in_flight', 'A purchase is already running')
      return
    }
    this.grantInFlight.add(player.playerId)
    try {
      const store = this.cosmetics
      const outcome =
        message.kind === 'buyCosmetic'
          ? await buyCosmetic(player.playerId, message.cosmeticId, { ledger: this.ledger, store })
          : await wearCosmetic(player.playerId, message.cosmeticId, { store })
      if (outcome.kind === 'purchased') connection.balance = outcome.balance
      if (outcome.kind === 'purchased' || outcome.kind === 'worn') {
        connection.ownedCosmetics = await store.list(player.playerId)
      }
      this.send(connection, { kind: 'cosmetic', requestId: message.requestId, outcome })
    } catch {
      this.error(connection, message.requestId, 'cosmetic_failed', 'That could not be processed')
    } finally {
      this.grantInFlight.delete(player.playerId)
    }
  }

  private isSeated(playerId: string): boolean {
    const connection = this.activePlayers.get(playerId)
    if (connection === undefined || connection.roomId === null) return false
    const state = this.rooms.get(connection.roomId)
    if (state === undefined) return false
    return state.room.viewFor(playerId).seats.some((seat) => seat.playerId === playerId)
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
      // Fill the table on the way into a hand, not when a seat is taken.
      // Seating bots as people arrive races them for seats, and a person who
      // clicked an empty chair a moment ago finds a bot in it.
      if (command.kind === 'startHand') this.seatBots(state)
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
      ownedItems: connection.ownedItems.map((entry) => ({ ...entry })),
      ownedCosmetics: connection.ownedCosmetics.map((entry) => ({ ...entry })),
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

  private async social(
    connection: ConnectionState,
    state: RoomState,
    message: Extract<ClientMessage, { kind: 'social' }>,
  ): Promise<void> {
    const player = connection.player
    if (player === null || connection.roomId === null) return
    const { command } = message
    if (
      command.kind === 'emote' &&
      state.room.viewFor(player.playerId).currentActor?.playerId === player.playerId
    ) {
      this.error(
        connection,
        message.requestId,
        'emote_unavailable',
        'Emotes are unavailable during your turn',
      )
      return
    }
    if (command.kind === 'speaking') {
      const wasSpeaking = state.speakingPlayers.has(player.playerId)
      if (wasSpeaking === command.speaking) return
      if (command.speaking) state.speakingPlayers.add(player.playerId)
      else state.speakingPlayers.delete(player.playerId)
      this.broadcastSocial(state, message.requestId, {
        kind: 'speaking',
        playerId: player.playerId,
        speaking: command.speaking,
      })
      return
    }
    if (!this.consumeSocialAction(state, player.playerId)) {
      this.error(
        connection,
        message.requestId,
        'rate_limited',
        'Slow down before sending another chat or emote',
      )
      return
    }
    const sentAtMs = state.room.config.nowMs()
    if (command.kind === 'chat') {
      this.broadcastSocial(state, message.requestId, {
        kind: 'chat',
        playerId: player.playerId,
        text: command.text,
        sentAtMs,
      })
      return
    }
    this.broadcastSocial(state, message.requestId, {
      kind: 'emote',
      playerId: player.playerId,
      emote: command.emote,
      sentAtMs,
    })
    state.activeEmotes.add(player.playerId)
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
      if (state.speakingPlayers.delete(player.playerId)) {
        this.broadcastSocial(state, null, {
          kind: 'speaking',
          playerId: player.playerId,
          speaking: false,
        })
      }
      state.connections.delete(connection)
      const result = state.room.submit({ kind: 'disconnect', playerId: player.playerId })
      if (result.ok) {
        this.broadcast(state, null, result.events)
        this.scheduleReconnectExpiry(state, player.playerId)
      }
    })
  }

  private room(roomId: string, venueId?: VenueId): RoomState {
    const existing = this.rooms.get(roomId)
    // A venue only applies to a table being created. Applying it to one that
    // already exists would move everyone already sitting there.
    if (existing !== undefined) return existing
    const created: RoomState = {
      room: this.createRoom(roomId, venueId),
      connections: new Set(),
      queue: Promise.resolve(),
      reconnectTimers: new Map(),
      seedTimer: null,
      turnTimer: null,
      socialActions: new Map(),
      speakingPlayers: new Set(),
      activeEmotes: new Set(),
      botTimer: null,
      botCast: new Map(),
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

  /**
   * Fill empty seats so a person can play without finding eight friends.
   *
   * Bots are seated straight into the room rather than through the command
   * path, because that path debits the chip ledger and a bot has no bankroll.
   * They keep the cast the room seed chose, so leaving and coming back finds
   * the same opponents rather than a new table of strangers.
   */
  private seatBots(state: RoomState, target = this.botSeats): void {
    if (target <= 0) return
    const view = state.room.viewFor('')
    const wanted = botsWanted(view, target)
    if (wanted <= 0) return
    const seats = emptySeatsIn(view)
    const taken = new Set(state.botCast.keys())
    const cast = botsForTable(state.room.id, target + taken.size).filter(
      (personality) => !taken.has(botPlayerId(personality.id)),
    )
    const buyIn = state.room.config.stake.defaultBuyIn
    for (let index = 0; index < wanted; index += 1) {
      const personality = cast[index]
      const seat = seats[index]
      if (personality === undefined || seat === undefined) break
      const playerId = botPlayerId(personality.id)
      state.room.submit({ kind: 'join', playerId, name: personality.name })
      const result = state.room.submit({ kind: 'sit', playerId, seat, buyIn })
      if (result.ok) state.botCast.set(playerId, personality)
    }
  }

  /**
   * Act for a bot whose turn it is, after a pause.
   *
   * An instant answer is the clearest tell that a table is not real. The pause
   * always lands well inside the turn budget, so a bot can never be the reason
   * a hand times out.
   */
  private scheduleBotTurn(state: RoomState): void {
    this.clearBotTurn(state)
    const view = state.room.viewFor('')
    const actor = view.currentActor?.playerId
    if (actor === undefined || !isBotPlayer(actor)) return
    const personality = state.botCast.get(actor)
    if (personality === undefined) return

    const rng = this.botRng
    const delay = Math.min(thinkingMs(personality, rng), this.remainingTurnMs(state) * 0.6)
    state.botTimer = setTimeout(
      () => {
        void this.enqueue(state, async () => {
          state.botTimer = null
          const current = state.room.viewFor(actor)
          const action = actionFor(current, actor, personality, rng)
          if (action === null) return
          const result = state.room.submit({ kind: 'act', playerId: actor, action })
          if (result.ok) this.broadcast(state, null, result.events)
        })
      },
      Math.max(120, delay),
    )
  }

  private remainingTurnMs(state: RoomState): number {
    const deadline = state.room.viewFor('').turnDeadlineMs
    if (deadline === null) return DEFAULT_BOT_THINK_CAP
    return Math.max(0, deadline - state.room.config.nowMs())
  }

  private clearBotTurn(state: RoomState): void {
    if (state.botTimer !== null) clearTimeout(state.botTimer)
    state.botTimer = null
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
    this.scheduleBotTurn(state)
    this.interruptEmotes(state, events)
    this.broadcastAvatarVo(state, events)
  }

  private interruptEmotes(state: RoomState, events: RoomEvent[]): void {
    if (
      !events.some(
        (event) =>
          event.kind === 'handStarted' ||
          event.kind === 'blinds' ||
          event.kind === 'street' ||
          event.kind === 'acted' ||
          event.kind === 'timedOut' ||
          event.kind === 'awayPlayed' ||
          event.kind === 'uncontested' ||
          event.kind === 'showdown',
      )
    ) {
      return
    }
    for (const playerId of state.activeEmotes) {
      this.broadcastSocial(state, null, { kind: 'emoteInterrupted', playerId })
    }
    state.activeEmotes.clear()
  }

  private consumeSocialAction(state: RoomState, playerId: string): boolean {
    const now = state.room.config.nowMs()
    const { maxActions, windowMs } = state.room.config.socialRateLimit
    const recent = (state.socialActions.get(playerId) ?? []).filter((at) => at > now - windowMs)
    if (recent.length >= maxActions) {
      state.socialActions.set(playerId, recent)
      return false
    }
    recent.push(now)
    state.socialActions.set(playerId, recent)
    return true
  }

  private broadcastSocial(state: RoomState, requestId: string | null, event: SocialEvent): void {
    for (const connection of state.connections) {
      if (connection.roomId === null) continue
      this.send(connection, {
        kind: 'social',
        roomId: connection.roomId,
        requestId: connection === this.activePlayers.get(event.playerId) ? requestId : null,
        event,
      })
    }
  }

  private broadcastAvatarVo(state: RoomState, events: RoomEvent[]): void {
    const sentAtMs = state.room.config.nowMs()
    for (const event of events) {
      if (event.kind === 'acted' && event.action.kind === 'allIn') {
        this.broadcastSocial(state, null, {
          kind: 'avatarVo',
          playerId: event.playerId,
          trigger: 'allIn',
          sentAtMs,
        })
      }
      if (event.kind === 'uncontested') {
        this.broadcastSocial(state, null, {
          kind: 'avatarVo',
          playerId: event.playerId,
          trigger: 'win',
          sentAtMs,
        })
      }
      if (event.kind === 'showdown') {
        const winnerIds = new Set(event.awards.map((award) => award.playerId))
        for (const seat of state.room.viewFor('').seats) {
          if (seat.playerId === null || seat.folded) continue
          this.broadcastSocial(state, null, {
            kind: 'avatarVo',
            playerId: seat.playerId,
            trigger: winnerIds.has(seat.playerId) ? 'win' : 'loss',
            sentAtMs,
          })
        }
      }
    }
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
      ownedItems: connection.ownedItems.map((entry) => ({ ...entry })),
      ownedCosmetics: connection.ownedCosmetics.map((entry) => ({ ...entry })),
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
