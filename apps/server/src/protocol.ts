import type { Card, LegalActions, StakeConfig, Street, TurnAction } from '@river/engine'

export type AwayPolicy = 'check-or-fold'
export type KickReason = 'host' | 'idle' | 'duplicate-session'

export interface RoomConfig {
  maxSeats: number
  stake: StakeConfig
  seed: string
  countdownMs: number
  nowMs: () => number
  awayPolicy: AwayPolicy
  inviteCode: string
  hostPlayerId: string
  reconnectGraceMs: number
}

export type RoomCommand =
  | { kind: 'join'; playerId: string; name: string; inviteCode?: string }
  | { kind: 'leave'; playerId: string }
  | { kind: 'sit'; playerId: string; seat: number; buyIn: number }
  | { kind: 'stand'; playerId: string }
  | { kind: 'startHand' }
  | { kind: 'act'; playerId: string; action: TurnAction }
  | { kind: 'rebuy'; playerId: string; amount: number }
  | { kind: 'disconnect'; playerId: string }
  | { kind: 'reconnect'; playerId: string }
  | { kind: 'kick'; byPlayerId: string; targetPlayerId: string; reason: KickReason }
  | { kind: 'expireReconnect'; playerId: string }

export type RoomEvent =
  | { kind: 'joined'; playerId: string; name: string }
  | { kind: 'left'; playerId: string }
  | { kind: 'seated'; playerId: string; seat: number; stack: number }
  | { kind: 'stood'; playerId: string; seat: number; stack: number }
  | { kind: 'rejected'; playerId: string | null; message: string }
  | { kind: 'handStarted'; handNumber: number; dealerSeat: number; commit: string }
  | { kind: 'blinds'; posts: { seat: number; amount: number }[] }
  | { kind: 'street'; street: Street; cards: Card[] }
  | { kind: 'awaiting'; playerId: string; seat: number; legal: LegalActions }
  | { kind: 'acted'; playerId: string; action: TurnAction }
  | { kind: 'awayPlayed'; playerId: string; action: TurnAction }
  | { kind: 'uncontested'; playerId: string; amount: number }
  | { kind: 'showdown'; awards: { playerId: string; amount: number }[] }
  | { kind: 'bust'; playerId: string }
  | { kind: 'between'; handNumber: number; countdownMs: number }
  | { kind: 'disconnected'; playerId: string }
  | { kind: 'reconnected'; playerId: string }
  | { kind: 'kicked'; playerId: string; reason: KickReason }
  | { kind: 'identityUpgraded'; playerId: string }

export interface RoomSeatView {
  seat: number
  playerId: string | null
  name: string | null
  stack: number
  betHand: number
  betStreet: number
  folded: boolean
  allIn: boolean
  hole: Card[] | null
  hasHole: boolean
  sittingOut: boolean
  busted: boolean
  disconnected: boolean
  dealer: boolean
}

export interface RoomView {
  handNumber: number
  phase: 'open' | 'hand' | 'between'
  street: Street
  board: Card[]
  pot: number
  currentBet: number
  countdownMs: number
  seats: RoomSeatView[]
  currentActor: { playerId: string; seat: number } | null
  legal: LegalActions | null
  commit: string | null
  message: string | null
  revealed: boolean
  selfId: string
  hostPlayerId: string
  inviteCode: string
}

export interface RoomResult {
  ok: boolean
  events: RoomEvent[]
}

export interface RoomHandle {
  readonly id: string
  readonly config: RoomConfig
  viewFor(playerId: string): RoomView
  totalChips(): number
  submit(command: RoomCommand): RoomResult
}
