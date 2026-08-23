import { at } from './util.js'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export interface SeatIn {
  id: string
  stack: number
}

export interface PlayerState {
  id: string
  stack: number
  betThisStreet: number
  betThisHand: number
  folded: boolean
  allIn: boolean
  acted: boolean
}

export interface SidePot {
  amount: number
  eligibleIds: string[]
}

export interface BettingOptions {
  seats: SeatIn[]
  dealerIndex: number
  smallBlind: number
  bigBlind: number
}

export class BettingError extends Error {}

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river']

export class BettingHand {
  readonly players: PlayerState[]
  street: Street = 'preflop'
  finished = false
  private readonly dealerIndex: number
  private readonly smallBlind: number
  private readonly bigBlind: number
  private obligation = 0
  private betLevel = 0
  private minRaiseSize: number
  private lastToAct = -1

  constructor(options: BettingOptions) {
    if (options.seats.length < 2) {
      throw new BettingError('betting needs at least two players')
    }
    this.players = options.seats.map((seat) => ({
      id: seat.id,
      stack: seat.stack,
      betThisStreet: 0,
      betThisHand: 0,
      folded: false,
      allIn: false,
      acted: false,
    }))
    this.dealerIndex = options.dealerIndex
    this.smallBlind = options.smallBlind
    this.bigBlind = options.bigBlind
    this.minRaiseSize = options.bigBlind
    this.postBlinds()
    this.obligation = options.bigBlind
    this.betLevel = options.bigBlind
  }

  get toActId(): string | undefined {
    if (this.finished) return undefined
    return this.findToAct()?.id
  }

  get currentBet(): number {
    return this.betLevel
  }

  get uncontestedWinnerId(): string | undefined {
    const active = this.players.filter((p) => !p.folded)
    return active.length === 1 ? at(active, 0).id : undefined
  }

  pot(): number {
    return this.players.reduce((sum, p) => sum + p.betThisHand, 0)
  }

  betToCall(id: string): number {
    const player = this.findPlayer(id)
    return Math.max(0, this.betLevel - player.betThisStreet)
  }

  minRaiseTo(): number {
    return this.betLevel + this.minRaiseSize
  }

  sidePots(): SidePot[] {
    const pots: SidePot[] = []
    const levels = [...new Set(this.players.map((p) => p.betThisHand))].sort((a, b) => a - b)
    let previous = 0
    for (const level of levels) {
      const slice = this.players.reduce(
        (sum, p) => sum + Math.max(0, Math.min(p.betThisHand, level) - previous),
        0,
      )
      const eligibleIds = this.players
        .filter((p) => !p.folded && p.betThisHand >= level)
        .map((p) => p.id)
      if (slice > 0) {
        pots.push({ amount: slice, eligibleIds })
      }
      previous = level
    }
    return pots
  }

  award(id: string, amount: number): void {
    const player = this.findPlayer(id)
    player.stack += amount
  }

  fold(id: string): void {
    this.act(id, (p) => {
      p.folded = true
      p.acted = true
    })
  }

  check(id: string): void {
    this.act(id, (p) => {
      if (this.betToCall(id) > 0) {
        throw new BettingError('cannot check when facing a bet')
      }
      p.acted = true
    })
  }

  call(id: string): void {
    this.act(id, (p) => {
      this.commit(p, this.betToCall(id))
      p.acted = true
    })
  }

  raiseTo(id: string, to: number): void {
    this.act(id, (p) => {
      const extra = to - p.betThisStreet
      if (extra > p.stack) {
        throw new BettingError('raise exceeds stack')
      }
      if (to < this.minRaiseTo()) {
        throw new BettingError(`raise below minimum of ${this.minRaiseTo()}`)
      }
      if (to <= this.betLevel) {
        throw new BettingError('raise must exceed the current bet')
      }
      this.minRaiseSize = to - this.betLevel
      this.betLevel = to
      this.obligation = to
      this.commit(p, extra)
      p.acted = true
    })
  }

  allIn(id: string): void {
    this.act(id, (p) => {
      const previousLevel = this.betLevel
      this.commit(p, p.stack)
      const total = p.betThisStreet
      if (total >= previousLevel + this.minRaiseSize) {
        this.minRaiseSize = total - previousLevel
        this.obligation = total
        this.betLevel = total
      } else if (total > this.betLevel) {
        this.betLevel = total
      }
      p.acted = true
    })
  }

  private act(id: string, apply: (p: PlayerState) => void): void {
    if (id !== this.toActId) {
      throw new BettingError(`not ${id}'s turn`)
    }
    const index = this.players.findIndex((p) => p.id === id)
    const player = at(this.players, index)
    apply(player)
    this.lastToAct = index
    this.afterAction()
  }

  private afterAction(): void {
    const active = this.players.filter((p) => !p.folded)
    if (active.length === 1) {
      this.finished = true
      this.lastToAct = -1
      return
    }
    if (this.findToAct() === null) {
      if (this.street === 'river') {
        this.finished = true
        this.lastToAct = -1
      } else {
        this.startNextStreet()
      }
    }
  }

  private startNextStreet(): void {
    this.street = STREET_ORDER[STREET_ORDER.indexOf(this.street) + 1] ?? 'river'
    for (const p of this.players) {
      p.betThisStreet = 0
      p.acted = false
    }
    this.obligation = 0
    this.betLevel = 0
    this.minRaiseSize = this.bigBlind
    this.lastToAct = -1
  }

  private postBlinds(): void {
    const count = this.players.length
    const smallIndex = count === 2 ? this.dealerIndex : this.after(this.dealerIndex)
    const bigIndex = this.after(smallIndex)
    this.commit(at(this.players, smallIndex), this.smallBlind)
    this.commit(at(this.players, bigIndex), this.bigBlind)
  }

  private firstToActIndex(): number {
    if (this.street === 'preflop') {
      const count = this.players.length
      const bigIndex =
        count === 2 ? this.after(this.dealerIndex) : this.after(this.after(this.dealerIndex))
      return count === 2 ? bigIndex : this.after(bigIndex)
    }
    return this.after(this.dealerIndex)
  }

  private findToAct(): PlayerState | null {
    const count = this.players.length
    const start = this.lastToAct === -1 ? this.firstToActIndex() : this.after(this.lastToAct)
    for (let step = 0; step < count; step++) {
      const player = at(this.players, (start + step) % count)
      if (this.mustAct(player)) return player
    }
    return null
  }

  private mustAct(player: PlayerState): boolean {
    if (player.folded || player.allIn) return false
    if (!player.acted) return true
    return player.betThisStreet < this.obligation
  }

  private after(index: number): number {
    return (index + 1) % this.players.length
  }

  private commit(player: PlayerState, amount: number): void {
    const paid = Math.min(amount, player.stack)
    if (paid < 0) {
      throw new BettingError('cannot commit a negative amount')
    }
    player.stack -= paid
    player.betThisStreet += paid
    player.betThisHand += paid
    if (player.stack === 0) {
      player.allIn = true
    }
  }

  private findPlayer(id: string): PlayerState {
    const player = this.players.find((p) => p.id === id)
    if (player === undefined) {
      throw new BettingError(`unknown player: ${id}`)
    }
    return player
  }
}
