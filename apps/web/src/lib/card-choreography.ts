import type { Card } from '@river/engine'
import type { RoomView } from '@river/server'
import { DEAL_TEMPO } from './deal-tempo'
import type { ShowdownPlan } from './showdown-plan'

/**
 * Where the table's cards go, as moves the 2D felt can draw.
 *
 * The view says which seats hold cards and what the board is, never how they got there: a
 * new hand simply has cards, a new street simply has a longer board. The dealer turns those
 * into moves - two rounds of hole cards pitched clockwise from the seat after the button; a
 * burn, a beat and the street before every street; folded hands into the muck; the shown
 * hands turned over in the order the showdown is told; and every card back to the dealer
 * once the pot has gone.
 *
 * Pure: the table hands it views and a clock, and draws what it returns. Times are
 * milliseconds on that clock.
 */

export type CardPlace =
  | { kind: 'shoe' }
  | { kind: 'muck' }
  | { kind: 'hole'; seat: number; index: number }
  | { kind: 'board'; index: number }

export interface CardMove {
  from: CardPlace
  to: CardPlace
  startAt: number
  endAt: number
}

export interface CardSprite {
  id: string
  kind: 'hole' | 'board' | 'burn'
  seat: number | null
  index: number
  /** The face, once it is known and the card is to be turned. */
  card: Card | null
  moves: readonly CardMove[]
  /** When the card starts turning face up. */
  flipAt: number | null
  /** When it leaves the felt. */
  hideAt: number | null
}

export interface CardChoreography {
  /** The hand the sprites belong to; -1 before the first view. */
  hand: number
  /** Board cards dealt so far this hand. */
  boardDealt: number
  /** When the dealer is next free. */
  cursor: number
  sprites: readonly CardSprite[]
  /** Seats whose hands have gone into the muck. */
  mucked: ReadonlySet<number>
  /** Whether this hand's cards have been collected. */
  closed: boolean
  /** The showdown already applied, by when it started. */
  showdownAt: number | null
  /**
   * When the showdown is actually told: after the board has finished, all-in run-out
   * included. Captions, payouts and hand names start from this, never from the message
   * that ended the hand, or they give the ending away while the river is still coming.
   */
  showdownStartsAt: number | null
}

export interface ChoreographyInput {
  handNumber: number
  phase: RoomView['phase']
  board: readonly Card[]
  seats: readonly { seat: number; hasHole: boolean; folded: boolean; dealer: boolean }[]
  /** Whether the showdown's hands have been revealed. */
  revealed: boolean
  /** Whether bets were on the lines before this view, so a sweep comes before the burn. */
  swept: boolean
  /** The showdown being told, and when on the clock it started. */
  showdown: { plan: ShowdownPlan; startedAt: number } | null
}

export function emptyChoreography(): CardChoreography {
  return {
    hand: -1,
    boardDealt: 0,
    cursor: 0,
    sprites: [],
    mucked: new Set(),
    closed: true,
    showdownAt: null,
    showdownStartsAt: null,
  }
}

/**
 * How many board cards are face up at `now`, counting from the first. The board in the
 * room view runs ahead of the felt; anything that names a hand reads this instead.
 */
export function boardShown(state: CardChoreography, now: number): number {
  let shown = 0
  for (let index = 0; index < 5; index += 1) {
    const sprite = state.sprites.find(
      (entry) =>
        entry.kind === 'board' &&
        entry.index === index &&
        (entry.hideAt === null || entry.hideAt > now),
    )
    if (sprite === undefined || sprite.flipAt === null || now < sprite.flipAt + DEAL_TEMPO.flip / 2)
      break
    shown += 1
  }
  return shown
}

const SHOE: CardPlace = { kind: 'shoe' }
const MUCK: CardPlace = { kind: 'muck' }

function lastPlace(sprite: CardSprite): CardPlace {
  return sprite.moves[sprite.moves.length - 1]?.to ?? SHOE
}

function landsAt(sprite: CardSprite): number {
  return sprite.moves[sprite.moves.length - 1]?.endAt ?? 0
}

function visibleAt(sprite: CardSprite, now: number): boolean {
  const first = sprite.moves[0]
  return (
    first !== undefined && now >= first.startAt && (sprite.hideAt === null || now < sprite.hideAt)
  )
}

/** Everything still on the felt goes back to the dealer, starting at `at`. */
function collect(sprites: readonly CardSprite[], at: number): CardSprite[] {
  return sprites.map((sprite) => {
    if (sprite.hideAt !== null && sprite.hideAt <= at) return sprite
    const from = lastPlace(sprite)
    const start = Math.max(at, landsAt(sprite))
    return {
      ...sprite,
      moves: [
        ...sprite.moves,
        { from, to: MUCK, startAt: start, endAt: start + DEAL_TEMPO.collect },
      ],
      hideAt: start + DEAL_TEMPO.collect,
    }
  })
}

/** Dealt seats in the order a dealer pitches to them: the seat after the button first. */
export function dealOrder(seats: ChoreographyInput['seats']): number[] {
  const count = seats.reduce((most, seat) => Math.max(most, seat.seat + 1), 0)
  const button = seats.find((seat) => seat.dealer)?.seat ?? -1
  return seats
    .filter((seat) => seat.hasHole)
    .map((seat) => seat.seat)
    .sort((left, right) => {
      const from = (seat: number) => (((seat - button - 1) % count) + count) % count
      return from(left) - from(right)
    })
}

/** The flop's three cards, then the turn and the river, as the streets a batch of cards makes. */
function streets(from: number, to: number): number[][] {
  const out: number[][] = []
  let index = from
  while (index < to) {
    if (index < 3) {
      const flop = [index]
      while (flop.length < 3 - from && index + flop.length < Math.min(3, to)) {
        flop.push(index + flop.length)
      }
      out.push(flop)
      index += flop.length
    } else {
      out.push([index])
      index += 1
    }
  }
  return out
}

/**
 * Move the table's cards on from one view to the next, at `now`.
 *
 * The first view a table sees - a page load, a reconnect - lays the cards where they are and
 * moves nothing: a reload in the middle of a hand is not a deal.
 */
export function advanceChoreography(
  state: CardChoreography,
  input: ChoreographyInput,
  now: number,
): CardChoreography {
  const firstSight = state.hand === -1
  let next: CardChoreography = state
  const dealt = input.seats.filter((seat) => seat.hasHole)

  // A new hand: the last hand's cards go in, and the new one is pitched round the table.
  if (input.handNumber !== state.hand && (input.phase === 'hand' || dealt.length > 0)) {
    let sprites: CardSprite[] = []
    let start = Math.max(now, state.cursor)
    if (!firstSight && !state.closed) {
      sprites = collect(state.sprites, start).filter((sprite) => sprite.hideAt !== null)
      start += DEAL_TEMPO.collect
    } else if (!firstSight) {
      sprites = state.sprites.filter((sprite) => sprite.hideAt === null || sprite.hideAt > now)
    }
    const order = dealOrder(input.seats)
    let cursor = start
    if (firstSight) {
      for (const seat of order) {
        if (input.seats.find((entry) => entry.seat === seat)?.folded === true) continue
        for (const index of [0, 1]) {
          const place: CardPlace = { kind: 'hole', seat, index }
          sprites.push({
            id: `h${input.handNumber}-s${seat}-${index}`,
            kind: 'hole',
            seat,
            index,
            card: null,
            moves: [{ from: place, to: place, startAt: now, endAt: now }],
            flipAt: null,
            hideAt: null,
          })
        }
      }
      cursor = now
    } else {
      const first = start + DEAL_TEMPO.lead
      order.forEach((seat, position) => {
        for (const index of [0, 1]) {
          const leave = first + (index * order.length + position) * DEAL_TEMPO.holeStagger
          sprites.push({
            id: `h${input.handNumber}-s${seat}-${index}`,
            kind: 'hole',
            seat,
            index,
            card: null,
            moves: [
              {
                from: SHOE,
                to: { kind: 'hole', seat, index },
                startAt: leave,
                endAt: leave + DEAL_TEMPO.holeFlight,
              },
            ],
            flipAt: null,
            hideAt: null,
          })
          cursor = Math.max(cursor, leave + DEAL_TEMPO.holeFlight)
        }
      })
    }
    next = {
      hand: input.handNumber,
      boardDealt: 0,
      cursor,
      sprites,
      mucked: new Set(
        firstSight ? input.seats.filter((seat) => seat.folded).map((seat) => seat.seat) : [],
      ),
      closed: false,
      showdownAt: null,
      showdownStartsAt: null,
    }
  } else if (firstSight) {
    next = { ...state, hand: input.handNumber, cursor: now, closed: input.phase !== 'hand' }
  }

  if (next.hand !== input.handNumber) return next

  // The board: a burn and a beat before every street, then its cards, turned in order.
  if (input.board.length > next.boardDealt) {
    const sprites = [...next.sprites]
    let cursor = Math.max(now, next.cursor)
    if (firstSight) {
      input.board.forEach((card, index) => {
        const place: CardPlace = { kind: 'board', index }
        sprites.push({
          id: `h${input.handNumber}-b${index}`,
          kind: 'board',
          seat: null,
          index,
          card,
          moves: [{ from: place, to: place, startAt: now, endAt: now }],
          flipAt: now - DEAL_TEMPO.flip,
          hideAt: null,
        })
      })
    } else {
      // An all-in run-out: the hand ended in the same message that dealt these streets.
      // Every live hand is turned face up first, in the order the showdown will tell them,
      // and the board then runs out a street at a time with a beat of its own and a breath
      // before the river - the same timings the server waits for, in runoutMs.
      const runout = input.showdown !== null && input.phase !== 'hand'
      const order = streets(next.boardDealt, input.board.length)
      if (runout && input.showdown !== null) {
        const tableAt = cursor + (input.swept ? DEAL_TEMPO.sweep : 0)
        const steps = input.showdown.plan.show.steps
        steps.forEach((step, position) => {
          const cards = input.showdown?.plan.cards.get(step.seat)
          for (let index = 0; index < sprites.length; index += 1) {
            const sprite = sprites[index] as CardSprite
            if (sprite.kind !== 'hole' || sprite.seat !== step.seat) continue
            const card = cards?.[sprite.index]
            if (card === undefined) continue
            const flipAt = Math.max(tableAt + position * DEAL_TEMPO.tableStagger, landsAt(sprite))
            sprites[index] = { ...sprite, card, flipAt }
          }
        })
        cursor =
          tableAt +
          Math.max(0, steps.length - 1) * DEAL_TEMPO.tableStagger +
          DEAL_TEMPO.flip +
          DEAL_TEMPO.tableHold
      }
      order.forEach((street, streetIndex) => {
        const last = streetIndex === order.length - 1
        const start = runout
          ? cursor +
            (streetIndex > 0 ? DEAL_TEMPO.runoutBeat : 0) +
            (last && order.length > 1 ? DEAL_TEMPO.riverBreath : 0)
          : cursor + (streetIndex === 0 && input.swept ? DEAL_TEMPO.sweep : 0)
        sprites.push({
          id: `h${input.handNumber}-x${street[0] ?? 0}`,
          kind: 'burn',
          seat: null,
          index: street[0] ?? 0,
          card: null,
          moves: [{ from: SHOE, to: MUCK, startAt: start, endAt: start + DEAL_TEMPO.burn }],
          flipAt: null,
          hideAt: null,
        })
        const slide = start + DEAL_TEMPO.burn + DEAL_TEMPO.beat
        const landed =
          slide + (street.length - 1) * DEAL_TEMPO.boardStagger + DEAL_TEMPO.boardFlight
        street.forEach((index, position) => {
          const leave = slide + position * DEAL_TEMPO.boardStagger
          sprites.push({
            id: `h${input.handNumber}-b${index}`,
            kind: 'board',
            seat: null,
            index,
            card: input.board[index] ?? null,
            moves: [
              {
                from: SHOE,
                to: { kind: 'board', index },
                startAt: leave,
                endAt: leave + DEAL_TEMPO.boardFlight,
              },
            ],
            flipAt: landed + DEAL_TEMPO.settle + position * DEAL_TEMPO.flipStagger,
            hideAt: null,
          })
        })
        cursor =
          landed +
          DEAL_TEMPO.settle +
          (street.length - 1) * DEAL_TEMPO.flipStagger +
          DEAL_TEMPO.flip
      })
    }
    next = { ...next, sprites, cursor, boardDealt: input.board.length }
  }

  // Folds: a hand goes into the muck once its cards have reached the seat, never before.
  const folding = input.seats.filter(
    (seat) => seat.folded && !next.mucked.has(seat.seat) && input.phase === 'hand',
  )
  if (folding.length > 0) {
    const mucked = new Set(next.mucked)
    const sprites = next.sprites.map((sprite) => {
      if (sprite.kind !== 'hole' || sprite.seat === null) return sprite
      if (!folding.some((seat) => seat.seat === sprite.seat)) return sprite
      const start = Math.max(now, landsAt(sprite))
      return {
        ...sprite,
        moves: [
          ...sprite.moves,
          { from: lastPlace(sprite), to: MUCK, startAt: start, endAt: start + DEAL_TEMPO.fold },
        ],
        hideAt: start + DEAL_TEMPO.fold,
      }
    })
    for (const seat of folding) mucked.add(seat.seat)
    next = { ...next, sprites, mucked }
  }

  // The showdown: shown hands turn over as the showdown is told, after the board is out.
  const showdown = input.showdown
  if (showdown !== null && next.showdownAt !== showdown.startedAt && !next.closed) {
    const offset = Math.max(0, next.cursor - showdown.startedAt)
    const sprites = next.sprites.map((sprite) => {
      if (sprite.kind !== 'hole' || sprite.seat === null) return sprite
      // Tabled for an all-in run-out: already face up, and not turned a second time.
      if (sprite.flipAt !== null && sprite.card !== null) return sprite
      const step = showdown.plan.show.steps.find((entry) => entry.seat === sprite.seat)
      const cards = showdown.plan.cards.get(sprite.seat)
      const card = cards?.[sprite.index]
      if (step === undefined || card === undefined) return sprite
      const turnAt = sprite.index === 0 ? step.revealAtMs : step.secondCardAtMs
      return { ...sprite, card, flipAt: showdown.startedAt + offset + turnAt }
    })
    const collectAt =
      showdown.startedAt + offset + showdown.plan.show.totalMs + DEAL_TEMPO.showdownHold
    next = {
      ...next,
      sprites: collect(sprites, collectAt),
      showdownAt: showdown.startedAt,
      showdownStartsAt: showdown.startedAt + offset,
      closed: true,
      cursor: collectAt + DEAL_TEMPO.collect,
    }
  }

  // An uncontested hand, or a showdown with nothing to tell: the cards go in after a hold.
  if (input.phase !== 'hand' && !next.closed && (!input.revealed || input.showdown === null)) {
    const at = Math.max(now, next.cursor) + DEAL_TEMPO.collectDelay
    next = {
      ...next,
      sprites: collect(next.sprites, at),
      closed: true,
      cursor: at + DEAL_TEMPO.collect,
    }
  }

  // Cards that have left the felt for good are dropped, so a long session keeps a short list.
  const kept = next.sprites.filter((sprite) => sprite.hideAt === null || sprite.hideAt > now - 50)
  return kept.length === next.sprites.length ? next : { ...next, sprites: kept }
}

export interface SpriteFrame {
  from: CardPlace
  to: CardPlace
  /** 0 at the start of the current move, 1 once it has landed. */
  travel: number
  /** 0 face down, 1 face up; the face swaps in at a half. */
  turn: number
}

function eased(t: number): number {
  // Fast off the shoe and settling onto the felt, the way a pitched card slows on cloth.
  return 1 - (1 - t) ** 3
}

/** Where a sprite is at `now`, or null when it is not on the felt. */
export function spriteFrame(sprite: CardSprite, now: number): SpriteFrame | null {
  if (!visibleAt(sprite, now)) return null
  let move = sprite.moves[0] as CardMove
  for (const candidate of sprite.moves) if (now >= candidate.startAt) move = candidate
  const span = move.endAt - move.startAt
  const travel = span <= 0 ? 1 : eased(Math.min(1, Math.max(0, (now - move.startAt) / span)))
  const turn =
    sprite.flipAt === null || sprite.card === null
      ? 0
      : Math.min(1, Math.max(0, (now - sprite.flipAt) / DEAL_TEMPO.flip))
  return { from: move.from, to: move.to, travel, turn }
}

/** Whether anything on the felt is still moving or turning at `now`. */
export function choreographyBusy(state: CardChoreography, now: number): boolean {
  return state.sprites.some((sprite) => {
    const last = sprite.moves[sprite.moves.length - 1]
    if (last !== undefined && last.endAt > now) return true
    if (sprite.flipAt !== null && sprite.card !== null && sprite.flipAt + DEAL_TEMPO.flip > now)
      return true
    return sprite.hideAt !== null && sprite.hideAt > now
  })
}

/** When a seat's second card lands, so the HUD can show the hand as it arrives. */
export function seatDealtAt(state: CardChoreography, seat: number): number | null {
  const sprite = state.sprites.find(
    (entry) => entry.kind === 'hole' && entry.seat === seat && entry.index === 1,
  )
  return sprite === undefined ? null : (sprite.moves[0]?.endAt ?? null)
}
