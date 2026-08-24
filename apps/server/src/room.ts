import { randomBytes } from 'node:crypto'
import type { Card, LegalActions, SidePot, Street, TurnAction } from '@river/engine'
import {
  BettingError,
  BettingHand,
  type Challenge,
  challengeProgressFor,
  compareRanks,
  computeRep,
  DEFAULT_STAKE,
  dailySet,
  earningRatePercent,
  evaluateBest,
  levelTable,
  type MetricTally,
  makeDeck,
  SEATS_PER_SHAPE,
} from '@river/engine'
import {
  type FairnessClientSeed,
  fairDeck,
  fairnessCommit,
  freshFairnessSeed,
  isFairnessSeed,
} from './fairness.js'
import type {
  AwayPolicy,
  KickReason,
  RoomCommand,
  RoomConfig,
  RoomEvent,
  RoomHandle,
  RoomResult,
  RoomSeatView,
  RoomView,
} from './protocol.js'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']
const DEFAULT_MAX_SEATS = SEATS_PER_SHAPE.full
const DEFAULT_TURN_BUDGETS_MS: Record<Street, number> = {
  preflop: 15_000,
  flop: 20_000,
  turn: 20_000,
  river: 25_000,
}
const DEFAULT_SOCIAL_RATE_LIMIT = { maxActions: 6, windowMs: 10_000 }

interface PlayerState {
  name: string
  seat: number | null
  disconnected: boolean
}

/**
 * Level for a REP total.
 *
 * Deliberately not `progressFor` from the barrel: challenges.ts and
 * rep-progression.ts both export a `progressFor`, so `export *` resolves to
 * whichever loads last. The server only needs the level number.
 */
function levelAt(totalRep: number): number {
  let level = 1
  for (const entry of levelTable()) {
    if (totalRep >= entry.repRequired) level = entry.level
  }
  return level
}

interface SeatState {
  playerId: string | null
  stack: number
  hole: Card[]
  busted: boolean
  /** Reputation, not chips. Never spendable, never through the ledger. */
  totalRep: number
  /** Challenge metrics for the current UTC day, reset when the day turns. */
  tally: MetricTally
  tallyDay: string
}

class DrawPile {
  private cursor = 0
  constructor(readonly cards: Card[]) {}
  next(): Card {
    const card = this.cards[this.cursor]
    this.cursor++
    if (card === undefined) {
      throw new Error('deck exhausted')
    }
    return card
  }
}

function emptyLegal(): LegalActions {
  return {
    fold: { enabled: false, amount: 0 },
    check: { enabled: false, amount: 0 },
    call: { enabled: false, amount: 0 },
    raiseTo: { enabled: false, min: 0 },
    allIn: { enabled: false, amount: 0 },
  }
}

export function defaultRoomConfig(overrides: Partial<RoomConfig> & { seed: string }): RoomConfig {
  const randomSource = overrides.randomBytes
  return {
    maxSeats: overrides.maxSeats ?? DEFAULT_MAX_SEATS,
    stake: overrides.stake ?? DEFAULT_STAKE,
    seed: overrides.seed,
    countdownMs: overrides.countdownMs ?? 3000,
    nowMs: overrides.nowMs ?? Date.now,
    awayPolicy: overrides.awayPolicy ?? ('check-or-fold' satisfies AwayPolicy),
    inviteCode: overrides.inviteCode ?? newInviteCode(randomSource),
    hostPlayerId: overrides.hostPlayerId ?? '',
    reconnectGraceMs: overrides.reconnectGraceMs ?? 30_000,
    seedCollectionMs: overrides.seedCollectionMs ?? 1_500,
    randomBytes: randomSource ?? randomBytes,
    turnBudgetsMs: overrides.turnBudgetsMs ?? DEFAULT_TURN_BUDGETS_MS,
    socialRateLimit: overrides.socialRateLimit ?? DEFAULT_SOCIAL_RATE_LIMIT,
  }
}

const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function newInviteCode(source?: (size: number) => Uint8Array): string {
  const bytes = source === undefined ? randomBytes(6) : source(6)
  if (bytes.length < 6) throw new Error('invite random source must return at least 6 bytes')
  return Array.from(bytes.slice(0, 6), (byte) => INVITE_ALPHABET[byte & 31] ?? 'R').join('')
}

function sameInvite(received: string | undefined, expected: string): boolean {
  return received?.trim().toUpperCase() === expected.toUpperCase()
}

export class Room implements RoomHandle {
  readonly id: string
  readonly config: RoomConfig
  private readonly players = new Map<string, PlayerState>()
  private readonly seats: SeatState[]
  private readonly fixedDeck: Card[] | null
  private handNumber = 0
  private phase: 'open' | 'seeding' | 'hand' | 'between' = 'open'
  private dealerSeat = -1
  private betting: BettingHand | null = null
  private board: Card[] = []
  private lastStreet: Street = 'preflop'
  private pendingPlayerId: string | null = null
  private turnDeadlineMs: number | null = null
  private betweenSince = 0
  private revealed = false
  private readonly revealedPlayerIds = new Set<string>()
  private drawPile: DrawPile | null = null
  private currentCommit: string | null = null
  private pendingServerSeed: string | null = null
  private currentServerSeed: string | null = null
  private revealedSeed: string | null = null
  private pendingClientSeeds = new Map<string, string>()
  private settledClientSeeds: FairnessClientSeed[] | null = null
  private status: string | null = null
  private readonly eventLog: RoomEvent[] = []

  constructor(id: string, config: RoomConfig, fixedDeck?: Card[]) {
    if (config.maxSeats < 2 || config.maxSeats > DEFAULT_MAX_SEATS) {
      throw new Error(`maxSeats must be between 2 and ${DEFAULT_MAX_SEATS}`)
    }
    for (const street of STREET_ORDER) {
      const budget = config.turnBudgetsMs[street]
      if (!Number.isFinite(budget) || budget <= 0) {
        throw new Error(`turn budget for ${street} must be positive`)
      }
    }
    if (
      !Number.isSafeInteger(config.socialRateLimit.maxActions) ||
      config.socialRateLimit.maxActions <= 0 ||
      !Number.isFinite(config.socialRateLimit.windowMs) ||
      config.socialRateLimit.windowMs <= 0
    ) {
      throw new Error('social rate limit must be positive')
    }
    this.id = id
    this.config = config
    this.seats = Array.from({ length: config.maxSeats }, () => ({
      playerId: null,
      stack: 0,
      hole: [],
      busted: false,
      totalRep: 0,
      tally: {},
      tallyDay: '',
    }))
    this.fixedDeck = fixedDeck ?? null
  }

  viewFor(playerId: string): RoomView {
    const betting = this.betting
    const seats: RoomSeatView[] = this.seats.map((seat, index) => {
      const player = seat.playerId === null ? null : (this.players.get(seat.playerId) ?? null)
      const bettingPlayer =
        seat.playerId === null
          ? null
          : (betting?.players.find((p) => p.id === seat.playerId) ?? null)
      const visible =
        seat.playerId === playerId ||
        (seat.playerId !== null && this.revealedPlayerIds.has(seat.playerId))
          ? seat.hole.map((card) => ({ ...card }))
          : null
      return {
        seat: index,
        playerId: seat.playerId,
        name: player?.name ?? null,
        stack: seat.stack,
        betHand: bettingPlayer?.betThisHand ?? 0,
        betStreet: bettingPlayer?.betThisStreet ?? 0,
        folded: bettingPlayer?.folded ?? false,
        allIn: bettingPlayer?.allIn ?? false,
        hole: visible,
        hasHole: seat.hole.length > 0,
        sittingOut: this.phase !== 'hand' && this.handNumber > 0 && seat.stack <= 0,
        busted: seat.busted,
        disconnected: player?.disconnected ?? false,
        dealer: index === this.dealerSeat,
      }
    })
    let currentActor: { playerId: string; seat: number } | null = null
    if (this.phase === 'hand' && betting !== null && betting.toActId !== undefined) {
      const actorSeat = this.seatOfPlayer(betting.toActId)
      if (actorSeat !== -1) {
        currentActor = { playerId: betting.toActId, seat: actorSeat }
      }
    }
    return {
      handNumber: this.handNumber,
      phase: this.phase,
      street: this.lastStreet,
      board: this.board.map((card) => ({ ...card })),
      pot: betting === null ? 0 : betting.pot(),
      currentBet: betting === null ? 0 : betting.currentBet,
      countdownMs:
        this.phase === 'between'
          ? Math.max(0, this.config.countdownMs - (this.now() - this.betweenSince))
          : 0,
      seats,
      currentActor,
      legal: this.pendingPlayerId === playerId ? this.legalFor(playerId) : null,
      turnDeadlineMs: this.turnDeadlineMs,
      turnBudgetMs:
        this.phase === 'hand' && this.turnDeadlineMs !== null
          ? this.config.turnBudgetsMs[this.lastStreet]
          : null,
      commit: this.currentCommit,
      revealedSeed: this.revealedSeed,
      clientSeeds:
        this.revealedSeed === null || this.settledClientSeeds === null
          ? null
          : this.settledClientSeeds.map((seed) => ({ ...seed })),
      message: this.status ?? null,
      revealed: this.revealed,
      selfId: playerId,
      challenges: this.challengesFor(playerId),
      hostPlayerId: this.config.hostPlayerId,
      inviteCode: this.config.inviteCode,
    }
  }

  totalChips(): number {
    const pending =
      this.betting === null ? 0 : this.betting.players.reduce((sum, p) => sum + p.betThisHand, 0)
    const seated = this.seats.reduce((sum, seat) => sum + seat.stack, 0)
    return seated + pending
  }

  submit(command: RoomCommand): RoomResult {
    switch (command.kind) {
      case 'join':
        return this.join(command.playerId, command.name, command.inviteCode)
      case 'leave':
        return this.leave(command.playerId)
      case 'sit':
        return this.sit(command.playerId, command.seat, command.buyIn)
      case 'stand':
        return this.stand(command.playerId)
      case 'startHand':
        return this.startHand()
      case 'submitSeed':
        return this.submitSeed(command.playerId, command.seed)
      case 'finalizeSeeds':
        return this.finalizeSeeds()
      case 'timeoutTurn':
        return this.timeoutTurn()
      case 'act':
        return this.act(command.playerId, command.action)
      case 'rebuy':
        return this.rebuy(command.playerId, command.amount)
      case 'disconnect':
        return this.disconnect(command.playerId)
      case 'reconnect':
        return this.reconnect(command.playerId)
      case 'kick':
        return this.kick(command.byPlayerId, command.targetPlayerId, command.reason)
      case 'expireReconnect':
        return this.expireReconnect(command.playerId)
    }
  }

  private join(playerId: string, name: string, inviteCode?: string): RoomResult {
    if (this.players.has(playerId)) {
      return this.reject(playerId, 'already joined')
    }
    const trimmed = name.trim()
    if (trimmed === '') {
      return this.reject(playerId, 'name required')
    }
    if (
      this.config.hostPlayerId !== '' &&
      inviteCode !== undefined &&
      !sameInvite(inviteCode, this.config.inviteCode)
    ) {
      return this.reject(playerId, 'That code does not match a table.')
    }
    if (this.config.hostPlayerId !== '' && this.players.size >= this.config.maxSeats) {
      return this.reject(playerId, 'That table is full.')
    }
    this.players.set(playerId, { name: trimmed, seat: null, disconnected: false })
    if (this.config.hostPlayerId === '') this.config.hostPlayerId = playerId
    return this.result({ kind: 'joined', playerId, name: trimmed })
  }

  private leave(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (this.phase === 'hand' || this.phase === 'seeding') {
      return this.reject(playerId, 'cannot leave mid-hand')
    }
    this.releaseSeat(player)
    this.players.delete(playerId)
    this.migrateHost(playerId)
    return this.result({ kind: 'left', playerId })
  }

  private sit(playerId: string, seatIndex: number, buyIn: number): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (player.seat !== null) {
      return this.reject(playerId, 'already seated')
    }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.seats.length) {
      return this.reject(playerId, 'invalid seat')
    }
    const seat = this.seatAt(seatIndex)
    if (seat.playerId !== null) {
      return this.reject(playerId, 'seat occupied')
    }
    if (this.phase === 'hand' || this.phase === 'seeding') {
      return this.reject(playerId, 'cannot sit mid-hand')
    }
    if (
      !Number.isFinite(buyIn) ||
      buyIn < this.config.stake.minBuyIn ||
      buyIn > this.config.stake.maxBuyIn
    ) {
      return this.reject(
        playerId,
        `buy-in must be between ${this.config.stake.minBuyIn} and ${this.config.stake.maxBuyIn}`,
      )
    }
    seat.playerId = playerId
    seat.stack = buyIn
    seat.hole = []
    seat.busted = false
    player.seat = seatIndex
    return this.result({ kind: 'seated', playerId, seat: seatIndex, stack: buyIn })
  }

  private stand(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (player.seat === null) {
      return this.reject(playerId, 'not seated')
    }
    if (this.phase === 'hand' || this.phase === 'seeding') {
      return this.reject(playerId, 'cannot stand mid-hand')
    }
    const seatIndex = player.seat
    const seat = this.seatAt(seatIndex)
    const stack = seat.stack
    this.releaseSeat(player)
    return this.result({ kind: 'stood', playerId, seat: seatIndex, stack })
  }

  private startHand(): RoomResult {
    if (this.phase === 'hand' || this.phase === 'seeding') {
      return this.reject(null, 'hand already in progress')
    }
    const active = this.activeSeats()
    if (active.length < 2) {
      return this.reject(null, 'at least two seated players with chips required')
    }
    this.dealerSeat = this.findNextDealer(this.dealerSeat === -1)
    this.handNumber++
    this.revealed = false
    this.revealedSeed = null
    this.settledClientSeeds = null
    this.revealedPlayerIds.clear()
    this.board = []
    this.betweenSince = 0
    this.status = null
    this.pendingPlayerId = null
    this.turnDeadlineMs = null
    for (const seat of this.seats) {
      seat.hole = []
    }
    this.pendingClientSeeds.clear()
    this.pendingServerSeed = freshFairnessSeed(this.config.randomBytes)
    this.currentServerSeed = null
    this.currentCommit = fairnessCommit(this.pendingServerSeed)
    this.phase = 'seeding'
    const events: RoomEvent[] = [
      { kind: 'seedCommitted', handNumber: this.handNumber, commit: this.currentCommit },
    ]
    if (this.config.seedCollectionMs === 0) this.finalizeSeedsInto(events)
    this.log(events)
    return { ok: true, events }
  }

  private submitSeed(playerId: string, seed: string): RoomResult {
    if (this.phase !== 'seeding') return this.reject(playerId, 'seed collection is not active')
    const player = this.players.get(playerId)
    if (player === undefined || player.seat === null || !isFairnessSeed(seed)) {
      return this.reject(playerId, 'invalid client seed')
    }
    const seat = this.seatAt(player.seat)
    if (seat.stack <= 0 || seat.playerId !== playerId) return this.reject(playerId, 'not active')
    this.pendingClientSeeds.set(playerId, seed.toLowerCase())
    const events: RoomEvent[] = [{ kind: 'seedSubmitted', playerId, seat: player.seat }]
    if (
      this.activeSeats().every(
        (activeSeat) =>
          activeSeat.playerId !== null && this.pendingClientSeeds.has(activeSeat.playerId),
      )
    ) {
      this.finalizeSeedsInto(events)
    }
    this.log(events)
    return { ok: true, events }
  }

  private finalizeSeeds(): RoomResult {
    if (this.phase !== 'seeding') return this.reject(null, 'seed collection is not active')
    const events: RoomEvent[] = []
    this.finalizeSeedsInto(events)
    this.log(events)
    return { ok: true, events }
  }

  private finalizeSeedsInto(events: RoomEvent[]): void {
    const serverSeed = this.pendingServerSeed
    const commit = this.currentCommit
    if (serverSeed === null || commit === null) throw new Error('fairness commitment missing')
    const active = this.activeSeats()
    const clientSeeds: FairnessClientSeed[] = active.map((seat) => {
      const playerId = seat.playerId
      if (playerId === null) throw new Error('active seat missing player')
      const submitted = this.pendingClientSeeds.get(playerId)
      return {
        playerId,
        seat: this.seatOfPlayer(playerId),
        seed: submitted ?? freshFairnessSeed(this.config.randomBytes),
        defaulted: submitted === undefined,
      }
    })
    this.currentServerSeed = serverSeed
    this.pendingServerSeed = null
    this.settledClientSeeds = clientSeeds
    this.drawPile =
      this.fixedDeck === null
        ? new DrawPile(fairDeck(makeDeck(), serverSeed, clientSeeds))
        : new DrawPile([...this.fixedDeck])
    const dealerActive = active.findIndex(
      (seat) => seat.playerId === this.playerAt(this.dealerSeat),
    )
    const dealOrder = this.dealOrder(active, dealerActive === -1 ? 0 : dealerActive)
    for (let round = 0; round < 2; round++) {
      for (const seat of dealOrder) {
        seat.hole.push(this.drawPile.next())
      }
    }
    this.betting = new BettingHand({
      seats: active.map((seat) => ({ id: seat.playerId ?? '', stack: seat.stack })),
      dealerIndex: dealerActive === -1 ? 0 : dealerActive,
      smallBlind: this.config.stake.smallBlind,
      bigBlind: this.config.stake.bigBlind,
    })
    for (const seat of active) {
      const player = this.betting.players.find((p) => p.id === seat.playerId)
      if (player !== undefined) {
        seat.stack = player.stack
      }
    }
    this.lastStreet = this.betting.street
    this.phase = 'hand'
    events.push({
      kind: 'handStarted',
      handNumber: this.handNumber,
      dealerSeat: this.dealerSeat,
      commit,
    })
    const posts: { seat: number; amount: number }[] = []
    for (const player of this.betting.players) {
      if (player.betThisHand > 0) {
        posts.push({ seat: this.seatOfPlayer(player.id), amount: player.betThisHand })
      }
    }
    if (posts.length > 0) {
      events.push({ kind: 'blinds', posts })
    }
    this.drive(events)
  }

  private act(playerId: string, action: TurnAction): RoomResult {
    if (this.phase !== 'hand' || this.pendingPlayerId !== playerId || this.betting === null) {
      return this.reject(playerId, 'not your turn')
    }
    if (this.turnDeadlineMs !== null && this.now() >= this.turnDeadlineMs) {
      return this.timeoutTurn()
    }
    const events: RoomEvent[] = []
    this.status = null
    if (!this.apply(playerId, action, events, 'acted')) {
      return this.reject(playerId, this.status ?? 'invalid action')
    }
    this.pendingPlayerId = null
    this.turnDeadlineMs = null
    this.drive(events)
    return { ok: true, events }
  }

  private timeoutTurn(): RoomResult {
    const playerId = this.pendingPlayerId
    const deadline = this.turnDeadlineMs
    if (this.phase !== 'hand' || this.betting === null || playerId === null || deadline === null) {
      return this.reject(null, 'no active turn to timeout')
    }
    if (this.now() < deadline) return this.reject(playerId, 'turn deadline not reached')
    const legal = this.legalFor(playerId)
    const action: TurnAction = legal.check.enabled ? { kind: 'check' } : { kind: 'fold' }
    const events: RoomEvent[] = []
    this.status = null
    this.turnDeadlineMs = null
    if (!this.apply(playerId, action, events, 'timedOut')) {
      return this.reject(playerId, this.status ?? 'timeout action failed')
    }
    this.pendingPlayerId = null
    this.drive(events)
    return { ok: true, events }
  }

  private rebuy(playerId: string, amount: number): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (player.seat === null) {
      return this.reject(playerId, 'not seated')
    }
    if (this.phase === 'hand' || this.phase === 'seeding') {
      return this.reject(playerId, 'cannot rebuy mid-hand')
    }
    const seat = this.seatAt(player.seat)
    if (!Number.isFinite(amount) || amount <= 0 || amount > this.config.stake.maxBuyIn) {
      return this.reject(playerId, 'invalid rebuy amount')
    }
    if (seat.stack + amount > this.config.stake.maxBuyIn) {
      return this.reject(playerId, 'rebuy exceeds maximum stack')
    }
    seat.stack += amount
    seat.busted = false
    return this.result({ kind: 'seated', playerId, seat: player.seat, stack: seat.stack })
  }

  private disconnect(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (player.disconnected) {
      return this.reject(playerId, 'already disconnected')
    }
    player.disconnected = true
    const events: RoomEvent[] = [{ kind: 'disconnected', playerId }]
    if (this.phase === 'hand' && this.pendingPlayerId === playerId) {
      this.drive(events)
    }
    return { ok: true, events }
  }

  private reconnect(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (!player.disconnected) {
      return this.reject(playerId, 'already connected')
    }
    player.disconnected = false
    return this.result({ kind: 'reconnected', playerId })
  }

  private kick(byPlayerId: string, targetPlayerId: string, reason: KickReason): RoomResult {
    if (reason === 'host' && byPlayerId !== this.config.hostPlayerId) {
      return this.reject(byPlayerId, 'only the host can remove a player')
    }
    const target = this.players.get(targetPlayerId)
    if (target === undefined) return this.reject(byPlayerId, 'not joined')
    if (reason === 'host' && targetPlayerId === byPlayerId) {
      return this.reject(byPlayerId, 'cannot remove yourself')
    }
    if (this.phase === 'seeding') {
      return this.reject(byPlayerId, 'cannot remove a player during seed collection')
    }
    const events: RoomEvent[] = []
    if (this.phase === 'hand' && this.betting !== null) {
      const player = this.betting.players.find((item) => item.id === targetPlayerId)
      if (player !== undefined && !player.folded && !player.allIn) {
        this.apply(targetPlayerId, { kind: 'fold' }, events, 'awayPlayed')
        this.pendingPlayerId = null
        this.drive(events)
      }
    }
    this.releaseSeat(target)
    this.players.delete(targetPlayerId)
    this.migrateHost(targetPlayerId)
    events.push({ kind: 'kicked', playerId: targetPlayerId, reason })
    this.log(events)
    return { ok: true, events }
  }

  private expireReconnect(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined || !player.disconnected)
      return this.reject(playerId, 'not disconnected')
    return this.kick(this.config.hostPlayerId, playerId, 'idle')
  }

  private reject(playerId: string | null, message: string): RoomResult {
    const event: RoomEvent = { kind: 'rejected', playerId, message }
    this.eventLog.push(event)
    return { ok: false, events: [event] }
  }

  private result(event: RoomEvent): RoomResult {
    this.eventLog.push(event)
    return { ok: true, events: [event] }
  }

  private log(events: RoomEvent[]): void {
    for (const event of events) {
      this.eventLog.push(event)
    }
  }

  private apply(
    playerId: string,
    action: TurnAction,
    events: RoomEvent[],
    eventKind: 'acted' | 'awayPlayed' | 'timedOut',
  ): boolean {
    const betting = this.betting
    if (betting === null) {
      return false
    }
    try {
      switch (action.kind) {
        case 'fold':
          betting.fold(playerId)
          break
        case 'check':
          betting.check(playerId)
          break
        case 'call':
          betting.call(playerId)
          break
        case 'raiseTo':
          betting.raiseTo(playerId, action.to)
          break
        case 'allIn':
          betting.allIn(playerId)
          break
      }
    } catch (error) {
      if (error instanceof BettingError) {
        this.status = error.message
        return false
      }
      throw error
    }
    this.syncStacks(betting)
    events.push({ kind: eventKind, playerId, action })
    this.advanceBoard(betting.street, events)
    return true
  }

  private drive(events: RoomEvent[]): void {
    while (this.betting !== null && !this.betting.finished) {
      const actorId = this.betting.toActId
      if (actorId === undefined) {
        this.pendingPlayerId = null
        this.turnDeadlineMs = null
        break
      }
      const player = this.players.get(actorId)
      const seatIndex = this.seatOfPlayer(actorId)
      if (player === undefined || seatIndex === -1) {
        this.pendingPlayerId = null
        this.turnDeadlineMs = null
        this.applyAway(actorId, events)
        continue
      }
      if (player.disconnected) {
        this.pendingPlayerId = null
        this.turnDeadlineMs = null
        this.applyAway(actorId, events)
        continue
      }
      this.pendingPlayerId = actorId
      this.turnDeadlineMs = this.now() + this.config.turnBudgetsMs[this.betting.street]
      events.push({
        kind: 'awaiting',
        playerId: actorId,
        seat: seatIndex,
        legal: this.legalFor(actorId),
      })
      return
    }
    if (this.phase === 'hand' && this.betting !== null && this.betting.finished) {
      this.settle(events)
    }
  }

  private applyAway(playerId: string, events: RoomEvent[]): void {
    const betting = this.betting
    if (betting === null) {
      return
    }
    const action: TurnAction =
      this.config.awayPolicy === 'check-or-fold' && betting.betToCall(playerId) === 0
        ? { kind: 'check' }
        : { kind: 'fold' }
    this.apply(playerId, action, events, 'awayPlayed')
  }

  /**
   * Credit REP to everyone dealt into the hand.
   *
   * REP is not chips. It never touches the ledger and is not spendable - it is
   * reputation, and it is kept deliberately separate from bankroll so the two
   * can sit near each other in the UI without sharing state.
   *
   * The scale comes from the table stake rather than a player's stack, so a
   * short stack at a big table earns the same as a deep one.
   */
  /**
   * Accumulate this player's challenge metrics for the day.
   *
   * The tally is per UTC day and resets when the day turns, so a challenge set
   * cannot be completed with yesterday's play. Metrics measure behaviour a
   * player controls by playing, never an outcome they cannot influence.
   */
  /**
   * The day's challenges with this player's progress.
   *
   * The set is seeded by the UTC day so every player at every table sees the
   * same three challenges, and the same day always yields the same set.
   */
  private challengesFor(playerId: string): {
    challenge: Challenge
    current: number
    complete: boolean
    fractionComplete: number
  }[] {
    const now = new Date(this.now())
    const day = now.toISOString().slice(0, 10)
    const daySeed = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000,
    )
    const seat = this.seats.find((one) => one.playerId === playerId)
    const tally = seat !== undefined && seat.tallyDay === day ? seat.tally : {}
    return dailySet(daySeed).map((challenge) => {
      const progress = challengeProgressFor(challenge, tally)
      return {
        challenge: progress.challenge,
        current: progress.current,
        complete: progress.complete,
        fractionComplete: progress.fractionComplete,
      }
    })
  }

  private tallyHand(
    seat: { tally: MetricTally; tallyDay: string },
    player: { id: string; folded: boolean; allIn: boolean },
    winners: ReadonlySet<string>,
  ): void {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    if (seat.tallyDay !== day) {
      seat.tally = {}
      seat.tallyDay = day
    }
    const bump = (metric: keyof MetricTally): void => {
      seat.tally[metric] = (seat.tally[metric] ?? 0) + 1
    }
    bump('handsPlayed')
    if (winners.has(player.id)) bump('handsWon')
    if (this.revealed && !player.folded) bump('showdownsReached')
    if (winners.has(player.id) && this.revealed) bump('potsScooped')
    if (player.folded && this.lastStreet === 'preflop') bump('foldsPreflop')
    if (player.allIn && !player.folded) bump('allInsSurvived')
  }

  private awardRep(winners: ReadonlySet<string>, events: RoomEvent[]): void {
    const betting = this.betting
    if (betting === null) return

    const awards: {
      playerId: string
      totalRep: number
      earningRatePercent: number
      levelBefore: number
      levelAfter: number
    }[] = []

    for (const player of betting.players) {
      const seat = this.seats.find((one) => one.playerId === player.id)
      if (seat === undefined) continue
      const breakdown = computeRep({
        wonHand: winners.has(player.id),
        reachedShowdown: this.revealed && !player.folded,
        // Scale from the table stake, not the player's stack, so a short stack
        // at a big table earns the same as a deep one.
        buyIn: this.config.stake.defaultBuyIn,
        tableItemModifiers: [],
        eventModifiers: [],
        challengeModifiers: [],
        otherModifiers: [],
      })
      this.tallyHand(seat, player, winners)
      const before = seat.totalRep
      seat.totalRep = before + breakdown.totalRep
      awards.push({
        playerId: player.id,
        totalRep: breakdown.totalRep,
        earningRatePercent: earningRatePercent(breakdown),
        levelBefore: levelAt(before),
        levelAfter: levelAt(seat.totalRep),
      })
    }

    if (awards.length > 0) {
      events.push({ kind: 'repAwarded', handNumber: this.handNumber, awards })
    }
  }

  private settle(events: RoomEvent[]): void {
    const betting = this.betting
    if (betting === null) {
      return
    }
    const winners = new Set<string>()
    this.advanceBoard(betting.street, events)
    const winnerId = betting.uncontestedWinnerId
    if (winnerId !== undefined) {
      const amount = betting.pot()
      betting.award(winnerId, amount)
      this.syncStacks(betting)
      winners.add(winnerId)
      events.push({ kind: 'uncontested', playerId: winnerId, amount })
    } else {
      this.revealed = true
      for (const player of betting.players) {
        if (!player.folded) {
          this.revealedPlayerIds.add(player.id)
        }
      }
      const awards: { playerId: string; amount: number }[] = []
      for (const pot of betting.sidePots()) {
        this.awardPot(betting, pot, awards)
      }
      this.syncStacks(betting)
      for (const award of awards) winners.add(award.playerId)
      events.push({ kind: 'showdown', awards })
    }
    if (this.currentServerSeed === null || this.settledClientSeeds === null) {
      throw new Error('fairness reveal missing')
    }
    this.awardRep(winners, events)
    this.revealedSeed = this.currentServerSeed
    events.push({
      kind: 'seedRevealed',
      handNumber: this.handNumber,
      serverSeed: this.revealedSeed,
      clientSeeds: this.settledClientSeeds.map((seed) => ({ ...seed })),
    })
    for (const seat of this.seats) {
      if (seat.stack <= 0 && seat.playerId !== null && !seat.busted) {
        seat.busted = true
        events.push({ kind: 'bust', playerId: seat.playerId })
      }
    }
    this.betting = null
    this.pendingPlayerId = null
    this.turnDeadlineMs = null
    this.phase = 'between'
    this.betweenSince = this.now()
    events.push({
      kind: 'between',
      handNumber: this.handNumber,
      countdownMs: this.config.countdownMs,
    })
  }

  private awardPot(
    betting: BettingHand,
    pot: SidePot,
    awards: { playerId: string; amount: number }[],
  ): void {
    const contenders = pot.eligibleIds.map((id) => {
      const seat = this.seatOfPlayer(id)
      const hole = seat === -1 ? [] : this.seatAt(seat).hole
      return { id, rank: evaluateBest([...hole, ...this.board]) }
    })
    let best = contenders[0]
    if (best === undefined) {
      return
    }
    let winnerIds = [best.id]
    for (const contender of contenders.slice(1)) {
      const cmp = compareRanks(contender.rank, best.rank)
      if (cmp > 0) {
        best = contender
        winnerIds = [contender.id]
      } else if (cmp === 0) {
        winnerIds.push(contender.id)
      }
    }
    const each = Math.floor(pot.amount / winnerIds.length)
    const remainder = pot.amount % winnerIds.length
    winnerIds.forEach((id, index) => {
      const amount = each + (index === 0 ? remainder : 0)
      betting.award(id, amount)
      awards.push({ playerId: id, amount })
    })
  }

  private legalFor(playerId: string): LegalActions {
    const betting = this.betting
    if (betting === null) {
      return emptyLegal()
    }
    const seatIndex = this.seatOfPlayer(playerId)
    const seat = seatIndex === -1 ? null : this.seatAt(seatIndex)
    if (seat === null || seat.playerId !== playerId) {
      return emptyLegal()
    }
    const cost = betting.betToCall(playerId)
    const raise = betting.minRaiseTo()
    const maxTo = seat.stack + betting.valueOf(playerId)
    return {
      fold: { enabled: true, amount: 0 },
      check: { enabled: cost === 0, amount: 0 },
      call: { enabled: cost > 0 && seat.stack > 0, amount: Math.min(cost, seat.stack) },
      raiseTo: { enabled: maxTo >= raise, min: raise },
      allIn: { enabled: seat.stack > 0, amount: maxTo },
    }
  }

  private advanceBoard(target: Street, events: RoomEvent[]): void {
    const drawPile = this.drawPile
    if (drawPile === null) {
      return
    }
    const currentIndex = STREET_ORDER.indexOf(this.lastStreet)
    const targetIndex = STREET_ORDER.indexOf(target)
    for (let index = currentIndex + 1; index <= targetIndex; index++) {
      const street = STREET_ORDER[index]
      if (street === undefined) {
        continue
      }
      this.lastStreet = street
      if (street === 'preflop') {
        continue
      }
      const count = street === 'flop' ? 3 : 1
      const cards = Array.from({ length: count }, () => drawPile.next())
      this.board.push(...cards)
      events.push({ kind: 'street', street, cards: cards.map((card) => ({ ...card })) })
    }
  }

  private findNextDealer(includeCurrent: boolean): number {
    const count = this.seats.length
    const start = this.dealerSeat === -1 ? 0 : this.dealerSeat
    const firstOffset = includeCurrent ? 0 : 1
    for (let offset = firstOffset; offset < count + firstOffset; offset++) {
      const index = (start + offset) % count
      const seat = this.seatAt(index)
      if (seat.playerId !== null && seat.stack > 0) {
        return index
      }
    }
    throw new Error('no active dealer seat')
  }

  private dealOrder(active: SeatState[], dealerActive: number): SeatState[] {
    const count = active.length
    if (count === 0) {
      return []
    }
    const first = count === 2 ? dealerActive : (dealerActive + 1) % count
    return Array.from({ length: count }, (_, k) => {
      const seat = active[(first + k) % count]
      if (seat === undefined) {
        throw new Error('deal order fell off the active list')
      }
      return seat
    })
  }

  private activeSeats(): SeatState[] {
    return this.seats.filter((seat) => seat.playerId !== null && seat.stack > 0)
  }

  private playerAt(seatIndex: number): string | null {
    const seat = this.seatAt(seatIndex)
    return seat.playerId
  }

  private seatOfPlayer(playerId: string): number {
    const player = this.players.get(playerId)
    return player?.seat ?? -1
  }

  private seatAt(index: number): SeatState {
    const seat = this.seats[index]
    if (seat === undefined) {
      throw new Error(`seat ${index} out of range`)
    }
    return seat
  }

  private releaseSeat(player: PlayerState): void {
    if (player.seat === null) {
      return
    }
    const seat = this.seatAt(player.seat)
    seat.playerId = null
    seat.stack = 0
    seat.hole = []
    seat.busted = false
    player.seat = null
  }

  private migrateHost(removedPlayerId: string): void {
    if (this.config.hostPlayerId !== removedPlayerId) return
    this.config.hostPlayerId = this.players.keys().next().value ?? ''
  }

  private syncStacks(betting: BettingHand): void {
    for (const seat of this.seats) {
      const playerId = seat.playerId
      if (playerId === null) {
        continue
      }
      const player = betting.players.find((p) => p.id === playerId)
      if (player !== undefined) {
        seat.stack = player.stack
      }
    }
  }

  private now(): number {
    return this.config.nowMs()
  }
}
