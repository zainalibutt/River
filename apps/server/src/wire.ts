import {
  type BotTablePreset,
  isBotTablePreset,
  SEATS_PER_SHAPE,
  type TableSummary,
  type TurnAction,
} from '@river/engine'
import type { AdminAction, AdminOutcome } from './admin.js'
import type { CosmeticOutcome, OwnedCosmetic } from './cosmetic-service.js'
import type { GrantOutcome } from './economy-service.js'
import { isFairnessSeed } from './fairness.js'
import {
  type Emote,
  isVenueId,
  type RabbitOffer,
  type RoomEvent,
  type RoomView,
  type TableSettings,
  type TurnTimerPreset,
  type VenueId,
} from './protocol.js'
import { isKnownStakeId, isTurnTimerPreset } from './room.js'
import type { EquipOutcome, OwnedItem, PurchaseOutcome } from './table-item-service.js'

export type ClientRoomCommand =
  | { kind: 'sit'; seat: number; buyIn: number }
  | { kind: 'stand' }
  | { kind: 'leave' }
  | { kind: 'startHand' }
  | { kind: 'submitSeed'; seed: string }
  | { kind: 'kick'; targetPlayerId: string; reason: 'host' }
  | { kind: 'act'; action: TurnAction }
  | { kind: 'rebuy'; amount: number }
  /** Show a losing hand at a showdown rather than throwing it away. */
  | { kind: 'showHands'; always: boolean }
  /** Turn over the board a hand that ended early never dealt. */
  | { kind: 'rabbitHunt' }

export type ClientSocialCommand =
  | { kind: 'chat'; text: string }
  | { kind: 'emote'; emote: Emote }
  | { kind: 'speaking'; speaking: boolean }
  /** A look at the cards; `holding` starts or ends one held open for as long as the press. */
  | { kind: 'peek'; holding?: boolean }

export type SocialEvent =
  | { kind: 'chat'; playerId: string; text: string; sentAtMs: number }
  | { kind: 'emote'; playerId: string; emote: Emote; sentAtMs: number }
  | { kind: 'emoteInterrupted'; playerId: string }
  | { kind: 'avatarVo'; playerId: string; trigger: 'allIn' | 'win' | 'loss'; sentAtMs: number }
  | { kind: 'speaking'; playerId: string; speaking: boolean }
  /** Somebody lifted their cards to look at them. Everyone at a real table sees that. */
  | { kind: 'peeked'; playerId: string; sentAtMs: number; holding?: boolean }

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
      maxSeats?: number
      stakeId?: string
      turnTimerPreset?: TurnTimerPreset
      botSeats?: number
      botPreset?: BotTablePreset
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
  | { kind: 'admin'; requestId: string; action: AdminAction }

export type ServerMessage =
  | { kind: 'authenticated'; playerId: string; anonymous: boolean; admin: boolean }
  | {
      kind: 'snapshot'
      roomId: string
      requestId: string | null
      view: RoomView
      balance: number
      ownedItems: OwnedItem[]
      ownedCosmetics: OwnedCosmetic[]
      events: RoomEvent[]
      /**
       * How many seats this table will fill with bots when a hand is dealt.
       *
       * The client needs it to know whether one person sitting alone can start
       * anything. Bots take their seats on the deal rather than as people
       * arrive, so a table that fills with them looks empty right up until the
       * moment it does not - and a client that reasons only from the seats it
       * can see concludes there is nobody to play against.
       */
      botSeats: number
      botPreset: BotTablePreset
      /** The rabbit this player may hunt or has seen, after a hand that ended early. */
      rabbit: RabbitOffer | null
    }
  | { kind: 'social'; roomId: string; requestId: string | null; event: SocialEvent }
  | { kind: 'tables'; requestId: string; tables: TableSummary[] }
  | { kind: 'cosmetic'; requestId: string; outcome: CosmeticOutcome }
  | { kind: 'grant'; requestId: string; outcome: GrantOutcome }
  | { kind: 'tableItem'; requestId: string; outcome: PurchaseOutcome | EquipOutcome }
  | { kind: 'adminResult'; requestId: string; outcome: AdminOutcome }
  | { kind: 'error'; requestId: string | null; code: string; message: string }

export interface RoomCreationSettings {
  venueId?: VenueId
  maxSeats?: TableSettings['maxSeats']
  stakeId?: TableSettings['stakeId']
  turnTimerPreset?: TableSettings['turnTimerPreset']
  botSeats?: number
  botPreset?: BotTablePreset
}

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/
const EMOTES: readonly Emote[] = [
  'wave',
  'laugh',
  'facepalm',
  'fistPump',
  'chipTrick',
  'dance',
  'confetti',
  'tableKnock',
]
const MAX_CHAT_LENGTH = 500

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
    case 'showHands':
      return typeof value.always === 'boolean' ? { kind: 'showHands', always: value.always } : null
    case 'rabbitHunt':
      return { kind: 'rabbitHunt' }
    default:
      return null
  }
}

function adminAction(value: unknown): AdminAction | null {
  if (!isObject(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'listBans') return { kind: 'listBans' }
  if (typeof value.targetPlayerId !== 'string') return null
  if (value.kind === 'grantChips' && Number.isSafeInteger(value.amount)) {
    return {
      kind: 'grantChips',
      targetPlayerId: value.targetPlayerId,
      amount: Number(value.amount),
    }
  }
  if (value.kind === 'setBan' && typeof value.banned === 'boolean') {
    return { kind: 'setBan', targetPlayerId: value.targetPlayerId, banned: value.banned }
  }
  return null
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
  if (value.kind === 'peek') {
    return typeof value.holding === 'boolean'
      ? { kind: 'peek', holding: value.holding }
      : { kind: 'peek' }
  }
  return null
}

function roomCreationSettings(
  value: Record<string, unknown>,
  midasAvailable: boolean,
): RoomCreationSettings | null {
  const maxSeats = value.maxSeats
  if (
    maxSeats !== undefined &&
    (typeof maxSeats !== 'number' ||
      !Number.isSafeInteger(maxSeats) ||
      !Object.values(SEATS_PER_SHAPE).includes(maxSeats))
  ) {
    return null
  }
  const stakeId = value.stakeId
  if (stakeId !== undefined && !isKnownStakeId(stakeId)) return null
  const turnTimerPreset = value.turnTimerPreset
  if (turnTimerPreset !== undefined && !isTurnTimerPreset(turnTimerPreset)) return null
  const venueId = value.venueId
  if (venueId !== undefined && !isVenueId(venueId)) return null
  // Every seat but one can take a bot, which leaves the person creating the
  // table somewhere to sit.
  const botSeats = value.botSeats
  if (
    botSeats !== undefined &&
    (typeof botSeats !== 'number' ||
      !Number.isSafeInteger(botSeats) ||
      botSeats < 0 ||
      botSeats > (maxSeats ?? SEATS_PER_SHAPE.full) - 1)
  ) {
    return null
  }
  const botPreset = value.botPreset
  if (botPreset !== undefined && !isBotTablePreset(botPreset)) return null
  if (botPreset === 'midas' && !midasAvailable) return null
  // Champion and Midas are heads-up matches against one character. Each needs
  // no size or count from the creator, and one that says otherwise is refused.
  const headsUpPreset = botPreset === 'champion' || botPreset === 'midas'
  const headsUp = SEATS_PER_SHAPE['heads-up']
  if (
    headsUpPreset &&
    ((maxSeats !== undefined && maxSeats !== headsUp) || (botSeats !== undefined && botSeats !== 1))
  ) {
    return null
  }
  const seats = headsUpPreset ? headsUp : maxSeats
  const bots = headsUpPreset ? 1 : botSeats
  return {
    ...(seats === undefined ? {} : { maxSeats: seats }),
    ...(stakeId === undefined ? {} : { stakeId }),
    ...(turnTimerPreset === undefined ? {} : { turnTimerPreset }),
    ...(venueId === undefined ? {} : { venueId }),
    ...(bots === undefined ? {} : { botSeats: bots }),
    ...(botPreset === undefined ? {} : { botPreset }),
  }
}

export function parseClientMessage(raw: string, midasAvailable = false): ClientMessage | null {
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
    const settings = roomCreationSettings(value, midasAvailable)
    if (settings === null) return null
    return {
      kind: 'enter',
      requestId,
      roomId: value.roomId,
      name: value.name,
      ...(inviteCode === undefined ? {} : { inviteCode }),
      ...settings,
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
  if (value.kind === 'admin') {
    const action = adminAction(value.action)
    return action === null ? null : { kind: 'admin', requestId, action }
  }
  return null
}
