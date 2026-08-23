import type { Card, LegalActions, SidePot, Street, TurnAction } from '@river/engine'
import {
  BettingError,
  BettingHand,
  commitSeed,
  compareRanks,
  DEFAULT_STAKE,
  evaluateBest,
  makeDeck,
  mulberry32,
  SEATS_PER_SHAPE,
  seedFromString,
  shuffle,
} from '@river/engine'
import type {
  AwayPolicy,
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

interface PlayerState {
  name: string
  seat: number | null
  disconnected: boolean
}

interface SeatState {
  playerId: string | null
  stack: number
  hole: Card[]
  busted: boolean
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
  return {
    maxSeats: overrides.maxSeats ?? DEFAULT_MAX_SEATS,
    stake: overrides.stake ?? DEFAULT_STAKE,
    seed: overrides.seed,
    countdownMs: overrides.countdownMs ?? 3000,
    nowMs: overrides.nowMs ?? (() => 0),
    awayPolicy: overrides.awayPolicy ?? ('check-or-fold' satisfies AwayPolicy),
  }
}

export class Room implements RoomHandle {
  readonly id: string
  readonly config: RoomConfig
  private readonly players = new Map<string, PlayerState>()
  private readonly seats: SeatState[]
  private readonly fixedDeck: Card[] | null
  private handNumber = 0
  private phase: 'open' | 'hand' | 'between' = 'open'
  private dealerSeat = -1
  private betting: BettingHand | null = null
  private board: Card[] = []
  private lastStreet: Street = 'preflop'
  private pendingPlayerId: string | null = null
  private betweenSince = 0
  private revealed = false
  private drawPile: DrawPile | null = null
  private currentCommit: string | null = null
  private status: string | null = null
  private readonly eventLog: RoomEvent[] = []

  constructor(id: string, config: RoomConfig, fixedDeck?: Card[]) {
    if (config.maxSeats < 2 || config.maxSeats > DEFAULT_MAX_SEATS) {
      throw new Error(`maxSeats must be between 2 and ${DEFAULT_MAX_SEATS}`)
    }
    this.id = id
    this.config = config
    this.seats = Array.from({ length: config.maxSeats }, () => ({
      playerId: null,
      stack: 0,
      hole: [],
      busted: false,
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
        seat.playerId === playerId || this.revealed ? seat.hole.map((card) => ({ ...card })) : null
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
        sittingOut: this.handNumber > 0 && seat.stack <= 0,
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
      commit: this.currentCommit,
      message: this.status ?? null,
      revealed: this.revealed,
      selfId: playerId,
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
        return this.join(command.playerId, command.name)
      case 'leave':
        return this.leave(command.playerId)
      case 'sit':
        return this.sit(command.playerId, command.seat, command.buyIn)
      case 'stand':
        return this.stand(command.playerId)
      case 'startHand':
        return this.startHand()
      case 'act':
        return this.act(command.playerId, command.action)
      case 'rebuy':
        return this.rebuy(command.playerId, command.amount)
      case 'disconnect':
        return this.disconnect(command.playerId)
      case 'reconnect':
        return this.reconnect(command.playerId)
    }
  }

  private join(playerId: string, name: string): RoomResult {
    if (this.players.has(playerId)) {
      return this.reject(playerId, 'already joined')
    }
    const trimmed = name.trim()
    if (trimmed === '') {
      return this.reject(playerId, 'name required')
    }
    this.players.set(playerId, { name: trimmed, seat: null, disconnected: false })
    return this.result({ kind: 'joined', playerId, name: trimmed })
  }

  private leave(playerId: string): RoomResult {
    const player = this.players.get(playerId)
    if (player === undefined) {
      return this.reject(playerId, 'not joined')
    }
    if (this.phase === 'hand') {
      return this.reject(playerId, 'cannot leave mid-hand')
    }
    this.releaseSeat(player)
    this.players.delete(playerId)
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
    if (this.phase === 'hand') {
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
    if (this.phase === 'hand') {
      return this.reject(playerId, 'cannot stand mid-hand')
    }
    const seatIndex = player.seat
    const seat = this.seatAt(seatIndex)
    const stack = seat.stack
    this.releaseSeat(player)
    return this.result({ kind: 'stood', playerId, seat: seatIndex, stack })
  }

  private startHand(): RoomResult {
    if (this.phase === 'hand') {
      return this.reject(null, 'hand already in progress')
    }
    const active = this.activeSeats()
    if (active.length < 2) {
      return this.reject(null, 'at least two seated players with chips required')
    }
    this.dealerSeat = this.findNextDealer(this.dealerSeat === -1)
    this.handNumber++
    this.revealed = false
    this.board = []
    this.betweenSince = 0
    this.status = null
    this.pendingPlayerId = null
    for (const seat of this.seats) {
      seat.hole = []
    }
    const handSeed = `${this.config.seed}|h${this.handNumber}`
    this.currentCommit = commitSeed(handSeed)
    this.drawPile =
      this.fixedDeck === null
        ? new DrawPile(shuffle(makeDeck(), mulberry32(seedFromString(`${handSeed}|deck`))))
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
    const events: RoomEvent[] = [
      {
        kind: 'handStarted',
        handNumber: this.handNumber,
        dealerSeat: this.dealerSeat,
        commit: this.currentCommit,
      },
    ]
    const posts: { seat: number; amount: number }[] = []
    for (const player of this.betting.players) {
      if (player.betThisHand > 0) {
        posts.push({ seat: this.seatOfPlayer(player.id), amount: player.betThisHand })
      }
    }
    if (posts.length > 0) {
      events.push({ kind: 'blinds', posts })
    }
    this.log(events)
    this.drive(events)
    return { ok: true, events }
  }

  private act(playerId: string, action: TurnAction): RoomResult {
    if (this.phase !== 'hand' || this.pendingPlayerId !== playerId || this.betting === null) {
      return this.reject(playerId, 'not your turn')
    }
    const events: RoomEvent[] = []
    this.status = null
    if (!this.apply(playerId, action, events)) {
      return this.reject(playerId, this.status ?? 'invalid action')
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
    if (this.phase === 'hand') {
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
    if (this.phase === 'hand') {
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

  private apply(playerId: string, action: TurnAction, events: RoomEvent[]): boolean {
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
    this.advanceBoard(betting.street, events)
    return true
  }

  private drive(events: RoomEvent[]): void {
    while (this.betting !== null && !this.betting.finished) {
      const actorId = this.betting.toActId
      if (actorId === undefined) {
        break
      }
      const player = this.players.get(actorId)
      const seatIndex = this.seatOfPlayer(actorId)
      if (player === undefined || seatIndex === -1) {
        this.applyAway(actorId, events)
        continue
      }
      if (player.disconnected) {
        this.applyAway(actorId, events)
        continue
      }
      this.pendingPlayerId = actorId
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
    if (this.apply(playerId, action, events)) {
      events.push({ kind: 'awayPlayed', playerId, action })
    }
  }

  private settle(events: RoomEvent[]): void {
    const betting = this.betting
    if (betting === null) {
      return
    }
    this.advanceBoard(betting.street, events)
    const winnerId = betting.uncontestedWinnerId
    if (winnerId !== undefined) {
      const amount = betting.pot()
      betting.award(winnerId, amount)
      this.syncStacks(betting)
      events.push({ kind: 'uncontested', playerId: winnerId, amount })
    } else {
      this.revealed = true
      const awards: { playerId: string; amount: number }[] = []
      for (const pot of betting.sidePots()) {
        this.awardPot(betting, pot, awards)
      }
      this.syncStacks(betting)
      events.push({ kind: 'showdown', awards })
    }
    for (const seat of this.seats) {
      if (seat.stack <= 0 && seat.playerId !== null && !seat.busted) {
        seat.busted = true
        events.push({ kind: 'bust', playerId: seat.playerId })
      }
    }
    this.betting = null
    this.pendingPlayerId = null
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
