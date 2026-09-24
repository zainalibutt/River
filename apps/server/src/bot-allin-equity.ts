import { type Card, cardKey, handScore, makeDeck, mulberry32, seedFromString } from '@river/engine'

/** Random boards drawn for an all-in before the flop; every later all-in is counted exactly. */
export const ALL_IN_EQUITY_TUNING = { preflopSamples: 4_000 } as const

export interface AllInSeat {
  readonly playerId: string
  /** Chips this seat put into the pot over the whole hand. */
  readonly contributed: number
  /** Still holding cards when the betting closed. */
  readonly contending: boolean
}

/**
 * The focal seat's expected chip change from a hand whose betting closed
 * before the river with two seats contending, valued at the focal seat's
 * showdown share over every board still to come rather than the one dealt.
 *
 * No decision remains once the betting closes, so on average this equals the
 * dealt result, without the luck of the cards still to come. Returns null
 * when the hand is not of that kind. `realised` is the chip change the table
 * paid; it must be one of the outcomes this pot allows, or the pot was read
 * wrongly and this throws.
 */
export function allInEquityChips(
  seats: readonly AllInSeat[],
  holes: ReadonlyMap<string, readonly Card[]>,
  board: readonly Card[],
  focalId: string,
  realised: number,
  seed: string,
): number | null {
  const contenders = seats.filter((seat) => seat.contending)
  if (contenders.length !== 2 || board.length >= 5) return null
  const focal = contenders.find((seat) => seat.playerId === focalId)
  const other = contenders.find((seat) => seat.playerId !== focalId)
  if (focal === undefined || other === undefined) return null
  const focalHole = holes.get(focal.playerId)
  const otherHole = holes.get(other.playerId)
  if (focalHole?.length !== 2 || otherHole?.length !== 2) return null
  const matched = Math.min(focal.contributed, other.contributed)
  if (seats.some((seat) => !seat.contending && seat.contributed > matched)) return null
  const contested = seats.reduce((sum, seat) => sum + Math.min(seat.contributed, matched), 0)
  const returned = focal.contributed - matched
  const outcomes = [contested, 0, contested / 2].map((won) => won + returned - focal.contributed)
  if (!outcomes.some((outcome) => Math.abs(outcome - realised) <= 1)) {
    throw new Error('all-in adjustment disagrees with the chips the table paid')
  }
  const share = showdownShare(focalHole, otherHole, board, seed)
  return share * contested + returned - focal.contributed
}

/** The first holding's share of the pot against the second over every board still to come. */
export function showdownShare(
  first: readonly Card[],
  second: readonly Card[],
  board: readonly Card[],
  seed: string,
): number {
  const known = new Set([...first, ...second, ...board].map(cardKey))
  const deck = makeDeck().filter((card) => !known.has(cardKey(card)))
  const score = (completed: readonly Card[]) => {
    const ours = handScore([...first, ...completed])
    const theirs = handScore([...second, ...completed])
    return ours > theirs ? 1 : ours === theirs ? 0.5 : 0
  }
  const missing = 5 - board.length
  let total = 0
  let count = 0
  if (missing === 0) return score(board)
  if (missing === 1) {
    for (const card of deck) {
      total += score([...board, card])
      count += 1
    }
  } else if (missing === 2) {
    for (let a = 0; a < deck.length; a += 1) {
      for (let b = a + 1; b < deck.length; b += 1) {
        total += score([...board, deck[a] as Card, deck[b] as Card])
        count += 1
      }
    }
  } else {
    const random = mulberry32(seedFromString(seed))
    for (let sample = 0; sample < ALL_IN_EQUITY_TUNING.preflopSamples; sample += 1) {
      const pool = [...deck]
      const completed: Card[] = [...board]
      while (completed.length < 5) {
        completed.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as Card)
      }
      total += score(completed)
      count += 1
    }
  }
  return total / count
}
