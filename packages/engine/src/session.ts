import type { SidePot, Street } from './betting.js'
import { BettingError, BettingHand } from './betting.js'
import type { BotDecision, BotDecisionInput, BotSkill } from './bots.js'
import { decideBotTurn } from './bots.js'
import type { Card } from './cards.js'
import { makeDeck } from './cards.js'
import type { StakeConfig } from './config.js'
import { BOT_PROFILES, DEFAULT_STAKE, SEATS_PER_SHAPE } from './config.js'
import { compareRanks, evaluateBest } from './evaluator.js'
import { commitSeed } from './fair.js'
import { mulberry32, seedFromString } from './rng.js'
import { shuffle } from './shuffle.js'
import { at } from './util.js'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']

export interface SessionSeatDef {
  id: string
  name: string
  botSkill: BotSkill | null
}

export interface SessionOptions {
  seats: SessionSeatDef[]
  rngSeed: string
  stake?: StakeConfig
  countdownMs?: number
  nowMs?: () => number
  stacks?: Record<string, number>
  fixedDeck?: Card[]
}

export type TurnAction =
  | { kind: 'fold' }
  | { kind: 'check' }
  | { kind: 'call' }
  | { kind: 'raiseTo'; to: number }
  | { kind: 'allIn' }

export interface LegalActions {
  fold: { enabled: boolean; amount: number }
  check: { enabled: boolean; amount: number }
  call: { enabled: boolean; amount: number }
  raiseTo: { enabled: boolean; min: number }
  allIn: { enabled: boolean; amount: number }
}

export interface ViewSeat {
  id: string
  name: string
  isBot: boolean
  stack: number
  betHand: number
  betStreet: number
  folded: boolean
  allIn: boolean
  hole: Card[] | null
  hasHole: boolean
  sittingOut: boolean
  busted: boolean
  dealer: boolean
}

export interface SoloTableView {
  handNumber: number
  phase: 'ready' | 'hand' | 'between'
  street: Street
  board: Card[]
  pot: number
  currentBet: number
  countdownMs: number
  seats: ViewSeat[]
  currentActorId: string | null
  legal: LegalActions | null
  commit: string | null
  message: string | null
  revealed: boolean
}

export type SessionStep =
  | { kind: 'notice'; message: string }
  | { kind: 'handStarted'; handNumber: number; dealerId: string; commit: string }
  | { kind: 'blind'; seatId: string; amount: number }
  | { kind: 'board'; street: Street; cards: Card[] }
  | { kind: 'action'; seatId: string; decision: BotDecision | TurnAction }
  | { kind: 'await'; seatId: string; legal: LegalActions }
  | { kind: 'uncontested'; seatId: string; amount: number }
  | { kind: 'showdown'; potAwards: { seatId: string; amount: number }[] }
  | { kind: 'bust'; seatId: string }
  | { kind: 'between'; countdownMs: number }

export interface ActResult {
  ok: boolean
  message: string | null
  steps: SessionStep[]
}

interface SeatState {
  def: SessionSeatDef
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

export class SoloSession {
  private readonly seats: SeatState[]
  private readonly initialStacks: ReadonlyMap<string, number>
  private readonly stake: StakeConfig
  private readonly rngSeed: string
  readonly countdownMs: number
  private readonly now: () => number
  private handNumber = 0
  private dealerIndex: number
  private phase: 'ready' | 'hand' | 'between' = 'ready'
  private betting: BettingHand | null = null
  private board: Card[] = []
  private currentCommit: string | null = null
  private lastStreet: Street = 'preflop'
  private pendingSeatId: string | null = null
  private betweenSince = 0
  private revealed = false
  private handRng: (() => number) | null = null
  private drawPile: DrawPile | null = null
  private readonly fixedDeck: Card[] | null
  private status: string | null = null
  private readonly stepLog: SessionStep[] = []

  constructor(options: SessionOptions) {
    if (options.seats.length < 2) {
      throw new Error('a session needs at least two seats')
    }
    if (options.seats.length > SEATS_PER_SHAPE.full) {
      throw new Error(`a session supports at most ${SEATS_PER_SHAPE.full} seats`)
    }
    if (new Set(options.seats.map((seat) => seat.id)).size !== options.seats.length) {
      throw new Error('session seat ids must be unique')
    }
    this.seats = options.seats.map((def) => {
      const stack = options.stacks?.[def.id] ?? (options.stake ?? DEFAULT_STAKE).defaultBuyIn
      if (!Number.isFinite(stack) || stack < 0) {
        throw new Error(`invalid stack for ${def.id}`)
      }
      return {
        def: { ...def },
        stack,
        hole: [],
        busted: stack === 0,
      }
    })
    this.initialStacks = new Map(this.seats.map((seat) => [seat.def.id, seat.stack]))
    this.stake = options.stake ?? DEFAULT_STAKE
    this.rngSeed = options.rngSeed
    this.countdownMs = options.countdownMs ?? 3000
    if (!Number.isFinite(this.countdownMs) || this.countdownMs < 0) {
      throw new Error('countdown must be a non-negative finite number')
    }
    this.now = options.nowMs ?? (() => 0)
    this.dealerIndex = 0
    this.fixedDeck = options.fixedDeck ?? null
  }

  view(): SoloTableView {
    const betting = this.betting
    return {
      handNumber: this.handNumber,
      phase: this.phase,
      street: this.lastStreet,
      board: this.board.map((card) => ({ ...card })),
      pot: betting === null ? 0 : betting.pot(),
      currentBet: betting === null ? 0 : betting.currentBet,
      countdownMs:
        this.phase === 'between'
          ? Math.max(0, this.countdownMs - (this.now() - this.betweenSince))
          : 0,
      seats: this.seats.map((seat, index) => {
        const player = betting?.players.find((p) => p.id === seat.def.id)
        return {
          id: seat.def.id,
          name: seat.def.name,
          isBot: seat.def.botSkill !== null,
          stack: seat.stack,
          betHand: player?.betThisHand ?? 0,
          betStreet: player?.betThisStreet ?? 0,
          folded: player?.folded ?? false,
          allIn: player?.allIn ?? false,
          hole:
            seat.def.botSkill === null || this.revealed
              ? seat.hole.map((card) => ({ ...card }))
              : null,
          hasHole: seat.hole.length > 0,
          sittingOut: this.handNumber > 0 && seat.stack <= 0,
          busted: seat.busted,
          dealer: index === this.dealerIndex,
        }
      }),
      currentActorId: this.phase === 'hand' && betting !== null ? (betting.toActId ?? null) : null,
      legal: this.pendingSeatId === null ? null : this.legalFor(this.pendingSeatId),
      commit: this.currentCommit,
      message: this.status ?? null,
      revealed: this.revealed,
    }
  }

  totalChips(): number {
    const pending =
      this.betting === null ? 0 : this.betting.players.reduce((sum, p) => sum + p.betThisHand, 0)
    const seated = this.seats.reduce((sum, seat) => sum + seat.stack, 0)
    return seated + pending
  }

  start(): SessionStep[] {
    return this.startHand()
  }

  startHand(): SessionStep[] {
    if (this.phase === 'hand') return []
    const active = this.seats.filter((seat) => seat.stack > 0)
    if (active.length < 2) {
      this.phase = 'between'
      this.status = 'Not enough seated players to deal a hand.'
      const notice: SessionStep = { kind: 'notice', message: this.status }
      this.stepLog.push(notice)
      return [notice]
    }
    this.dealerIndex = this.findNextDealer(this.handNumber === 0)
    this.handNumber++
    this.pendingSeatId = null
    this.revealed = false
    this.board = []
    this.betweenSince = 0
    this.status = null
    for (const seat of this.seats) {
      seat.hole = []
    }
    const dealerActive = active.findIndex(
      (seat) => seat.def.id === at(this.seats, this.dealerIndex).def.id,
    )
    const handSeed = `${this.rngSeed}|h${this.handNumber}`
    this.currentCommit = commitSeed(handSeed)
    this.handRng = mulberry32(seedFromString(`${handSeed}|rng`))
    this.drawPile =
      this.fixedDeck === null
        ? new DrawPile(shuffle(makeDeck(), mulberry32(seedFromString(`${handSeed}|deck`))))
        : new DrawPile([...this.fixedDeck])
    const dealOrder = this.dealOrder(active, dealerActive)
    for (let round = 0; round < 2; round++) {
      for (const seat of dealOrder) {
        seat.hole.push(this.drawPile.next())
      }
    }
    this.betting = new BettingHand({
      seats: active.map((seat) => ({ id: seat.def.id, stack: seat.stack })),
      dealerIndex: dealerActive,
      smallBlind: this.stake.smallBlind,
      bigBlind: this.stake.bigBlind,
    })
    for (const seat of active) {
      const player = this.betting.players.find((p) => p.id === seat.def.id)
      if (player !== undefined) {
        seat.stack = player.stack
      }
    }
    this.lastStreet = 'preflop'
    this.phase = 'hand'
    const steps: SessionStep[] = [
      {
        kind: 'handStarted',
        handNumber: this.handNumber,
        dealerId: at(this.seats, this.dealerIndex).def.id,
        commit: this.currentCommit,
      },
    ]
    for (const player of this.betting.players) {
      if (player.betThisHand > 0) {
        steps.push({ kind: 'blind', seatId: player.id, amount: player.betThisHand })
      }
    }
    for (const step of steps) {
      this.stepLog.push(step)
    }
    this.drive(steps)
    return steps
  }

  act(seatId: string, action: TurnAction): ActResult {
    if (this.phase !== 'hand' || this.pendingSeatId !== seatId || this.betting === null) {
      return { ok: false, message: 'It is not your turn.', steps: [] }
    }
    const steps: SessionStep[] = []
    this.status = null
    if (!this.apply(seatId, action, steps)) {
      return { ok: false, message: this.status ?? 'Invalid action.', steps: [] }
    }
    this.pendingSeatId = null
    this.drive(steps)
    return { ok: true, message: this.status ?? null, steps }
  }

  rebuy(seatId: string, amount?: number): boolean {
    const seat = this.findSeat(seatId)
    if (this.phase !== 'between') return false
    const value = amount ?? this.stake.defaultBuyIn
    if (value <= 0 || seat.stack + value > this.stake.maxBuyIn) return false
    seat.stack += value
    seat.busted = false
    return true
  }

  reset(): void {
    this.handNumber = 0
    this.dealerIndex = 0
    this.phase = 'ready'
    this.betting = null
    this.board = []
    this.currentCommit = null
    this.pendingSeatId = null
    this.betweenSince = 0
    this.revealed = false
    this.handRng = null
    this.drawPile = null
    this.lastStreet = 'preflop'
    this.status = null
    this.stepLog.length = 0
    for (const seat of this.seats) {
      seat.stack = this.initialStacks.get(seat.def.id) ?? this.stake.defaultBuyIn
      seat.hole = []
      seat.busted = seat.stack === 0
    }
  }

  history(): readonly SessionStep[] {
    return this.stepLog
  }

  private drive(steps: SessionStep[]): void {
    while (this.betting !== null && !this.betting.finished) {
      const actorId = this.betting.toActId
      if (actorId === undefined) break
      const seat = this.findSeat(actorId)
      if (seat.def.botSkill !== null) {
        if (this.handRng === null) throw new Error('hand rng missing')
        const profile = BOT_PROFILES[seat.def.botSkill]
        const decision = decideBotTurn(this.botInput(actorId), profile, this.handRng)
        if (!this.apply(actorId, decision, steps)) {
          throw new Error(`bot ${actorId} produced an illegal ${decision.kind} action`)
        }
        continue
      }
      this.pendingSeatId = actorId
      const step: SessionStep = { kind: 'await', seatId: actorId, legal: this.legalFor(actorId) }
      steps.push(step)
      this.stepLog.push(step)
      return
    }
    if (this.phase === 'hand' && this.betting !== null && this.betting.finished) {
      this.advanceBoard(this.betting.street, steps)
      this.settle(steps)
    }
  }

  private apply(seatId: string, action: BotDecision | TurnAction, steps: SessionStep[]): boolean {
    const betting = this.betting
    if (betting === null) return false
    try {
      switch (action.kind) {
        case 'fold':
          betting.fold(seatId)
          break
        case 'check':
          betting.check(seatId)
          break
        case 'call':
          betting.call(seatId)
          break
        case 'raiseTo':
          betting.raiseTo(seatId, action.to)
          break
        case 'allIn':
          betting.allIn(seatId)
          break
      }
    } catch (error) {
      if (error instanceof BettingError) {
        this.status = error.message
        return false
      }
      throw error
    }
    const actionStep: SessionStep = { kind: 'action', seatId, decision: { ...action } }
    steps.push(actionStep)
    this.stepLog.push(actionStep)
    for (const seat of this.seats) {
      const player = betting.players.find((p) => p.id === seat.def.id)
      if (player !== undefined) {
        seat.stack = player.stack
      }
    }
    this.advanceBoard(betting.street, steps)
    return true
  }

  private settle(steps: SessionStep[]): void {
    const betting = this.betting
    if (betting === null) return
    const winnerId = betting.uncontestedWinnerId
    if (winnerId !== undefined) {
      const amount = betting.pot()
      betting.award(winnerId, amount)
      for (const seat of this.seats) {
        const player = betting.players.find((p) => p.id === seat.def.id)
        if (player !== undefined) {
          seat.stack = player.stack
        }
      }
      const step: SessionStep = { kind: 'uncontested', seatId: winnerId, amount }
      steps.push(step)
      this.stepLog.push(step)
    } else {
      this.revealed = true
      const awards: { seatId: string; amount: number }[] = []
      for (const pot of betting.sidePots()) {
        this.awardPot(betting, pot, awards)
      }
      for (const seat of this.seats) {
        const player = betting.players.find((p) => p.id === seat.def.id)
        if (player !== undefined) {
          seat.stack = player.stack
        }
      }
      const step: SessionStep = { kind: 'showdown', potAwards: awards }
      steps.push(step)
      this.stepLog.push(step)
    }
    for (const seat of this.seats) {
      if (seat.stack <= 0 && !seat.busted) {
        seat.busted = true
        const step: SessionStep = { kind: 'bust', seatId: seat.def.id }
        steps.push(step)
        this.stepLog.push(step)
      }
    }
    this.betting = null
    this.pendingSeatId = null
    this.phase = 'between'
    this.betweenSince = this.now()
    const step: SessionStep = { kind: 'between', countdownMs: this.countdownMs }
    steps.push(step)
    this.stepLog.push(step)
  }

  private awardPot(
    betting: BettingHand,
    pot: SidePot,
    awards: { seatId: string; amount: number }[],
  ): void {
    const contenders = pot.eligibleIds.map((id) => {
      const seat = this.findSeat(id)
      return { id, rank: evaluateBest([...seat.hole, ...this.board]) }
    })
    let best = at(contenders, 0)
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
      awards.push({ seatId: id, amount })
    })
  }

  private botInput(seatId: string): BotDecisionInput {
    const betting = this.betting
    if (betting === null) throw new Error('no hand in progress')
    const seat = this.findSeat(seatId)
    return {
      street: betting.street,
      hole: seat.hole,
      board: this.board,
      betToCall: betting.betToCall(seatId),
      pot: betting.pot(),
      minRaiseTo: betting.minRaiseTo(),
      currentBet: betting.currentBet,
      stack: seat.stack,
      betThisStreet: betting.valueOf(seatId),
    }
  }

  private legalFor(seatId: string): LegalActions {
    const betting = this.betting
    if (betting === null) return emptyLegal()
    const seat = this.findSeat(seatId)
    const cost = betting.betToCall(seatId)
    const raise = betting.minRaiseTo()
    const committed = betting.valueOf(seatId)
    const maxTo = seat.stack + committed
    return {
      fold: { enabled: true, amount: 0 },
      check: { enabled: cost === 0, amount: 0 },
      call: { enabled: cost > 0 && seat.stack > 0, amount: Math.min(cost, seat.stack) },
      raiseTo: { enabled: maxTo >= raise, min: raise },
      allIn: { enabled: seat.stack > 0, amount: maxTo },
    }
  }

  private advanceBoard(target: Street, steps: SessionStep[]): void {
    const drawPile = this.drawPile
    if (drawPile === null) return
    const currentIndex = STREET_ORDER.indexOf(this.lastStreet)
    const targetIndex = STREET_ORDER.indexOf(target)
    for (let index = currentIndex + 1; index <= targetIndex; index++) {
      const street = at(STREET_ORDER, index)
      this.lastStreet = street
      if (street === 'preflop') continue
      const count = street === 'flop' ? 3 : 1
      const cards = Array.from({ length: count }, () => drawPile.next())
      this.board.push(...cards)
      const step: SessionStep = { kind: 'board', street, cards: cards.map((card) => ({ ...card })) }
      steps.push(step)
      this.stepLog.push(step)
    }
  }

  private findNextDealer(includeCurrent: boolean): number {
    const firstOffset = includeCurrent ? 0 : 1
    for (let offset = firstOffset; offset < this.seats.length + firstOffset; offset++) {
      const index = (this.dealerIndex + offset) % this.seats.length
      if (at(this.seats, index).stack > 0) return index
    }
    throw new Error('no active dealer seat')
  }

  private dealOrder(active: SeatState[], dealerActive: number): SeatState[] {
    const n = active.length
    const first = n === 2 ? dealerActive : (dealerActive + 1) % n
    return Array.from({ length: n }, (_, k) => at(active, (first + k) % n))
  }

  private findSeat(seatId: string): SeatState {
    const seat = this.seats.find((s) => s.def.id === seatId)
    if (seat === undefined) throw new Error(`unknown seat: ${seatId}`)
    return seat
  }
}
