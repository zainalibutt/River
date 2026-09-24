import type { Street } from './betting.js'
import { exactHeadsUpRiverEquity, handIsInPreflopRange, type PreflopRange } from './bot-equity.js'
import { holdingOf } from './bot-holding.js'
import { opponentRangeContext } from './bot-range-context.js'
import type { BotDecision, BotObservationV1, BotProfile } from './bots.js'
import { type Card, cardKey, makeDeck } from './cards.js'
import { handScore } from './fast-evaluator.js'
import { isAggressiveHandAction } from './hand-history.js'
import { mulberry32, type Rng, seedFromString } from './rng.js'

/**
 * How an OG plays after the flop when it judges hands by equity.
 *
 * Thresholds are equity against the range the opponent's public actions point
 * to, after discounting what cannot be realised out of position. The river
 * bluff rate is set so that bluffs are roughly the share that makes a call
 * break even against a three-quarter-pot bet (bluffs about 43% as common as
 * value bets); the solver in a later packet replaces this approximation.
 */
export const EQUITY_CORE_TUNING = {
  equityTrials: 120,
  realisation: { inPosition: 0.95, outOfPosition: 0.85 },
  drawImpliedOdds: 0.04,
  multiwayStep: 0.06,
  valueBet: { flop: 0.58, turn: 0.6, river: 0.62 },
  valueRaise: { flop: 0.72, turn: 0.75, river: 0.8 },
  betPot: { flop: 0.5, turn: 0.66, river: 0.75 },
  continuationPot: 0.33,
  continuationAir: 0.55,
  continuationDraw: 0.8,
  semiBluff: 0.5,
  riverBluff: 0.35,
  nearIndifferent: 0.08,
  nearIndifferentCall: 0.5,
  referenceBluffRate: 0.35,
  bluffMultiplier: { minimum: 0.6, maximum: 1.4 },
} as const

type Postflop = Exclude<Street, 'preflop'>
const RANGE_ORDER: readonly PreflopRange[] = ['random', 'loose', 'tight', 'premium']

/**
 * A personality's bluff rate as a bounded multiplier on the balanced rate, so
 * characters differ in how often they bluff without any of them spewing.
 */
export function bluffMultiplier(profile: Pick<BotProfile, 'bluffRate'>): number {
  const { minimum, maximum } = EQUITY_CORE_TUNING.bluffMultiplier
  const raw = profile.bluffRate / EQUITY_CORE_TUNING.referenceBluffRate
  return Math.min(maximum, Math.max(minimum, Number.isFinite(raw) ? raw : 1))
}

export function equityCoreDecision(
  observation: BotObservationV1,
  profile: BotProfile,
  rng: Rng,
): BotDecision | null {
  const { street, actor, board, pot, amountToCall, legal } = observation
  if (street === 'preflop' || actor.hole.length !== 2) return null
  const others = observation.seats.filter(
    (seat) => seat.playerId !== null && seat.playerId !== actor.playerId && !seat.folded,
  )
  if (others.length === 0) return null
  const actions = observation.actions ?? []
  const aggressorSeat = lastAggressor(actions, street)
  const ranges = others.map((seat) => {
    const read = observation.opponents.find((summary) => summary.playerId === seat.playerId)
    const central = opponentRangeContext(seat.seat, actions, read).centralScenario
    const shift = seat.seat === aggressorSeat ? 1 : 0
    return RANGE_ORDER[Math.min(RANGE_ORDER.length - 1, RANGE_ORDER.indexOf(central) + shift)]
  }) as PreflopRange[]
  const hole = actor.hole as unknown as [
    BotObservationV1['board'][number],
    BotObservationV1['board'][number],
  ]
  const equity = showdownShare(observation, hole, ranges)
  const inPosition = actsLast(
    observation,
    others.map((seat) => seat.seat),
  )
  const holding = holdingOf(actor.hole, board)
  const tuning = EQUITY_CORE_TUNING
  const multiway = (others.length - 1) * tuning.multiwayStep
  const realised =
    street === 'river'
      ? equity
      : equity * (inPosition ? tuning.realisation.inPosition : tuning.realisation.outOfPosition) +
        (holding === 'draw' ? tuning.drawImpliedOdds : 0)
  const tilt = bluffMultiplier(profile)
  const headsUp = others.length === 1
  const size = tuning.betPot[street as Postflop]

  if (amountToCall > 0) {
    const price = amountToCall / Math.max(1, pot + amountToCall)
    if (realised >= tuning.valueRaise[street as Postflop] + multiway) {
      return (
        raise(observation, observation.currentBet + (pot + amountToCall) * size) ??
        call(observation)
      )
    }
    if (
      headsUp &&
      holding === 'draw' &&
      street !== 'river' &&
      rng() < tuning.semiBluff * tilt * 0.5
    ) {
      return (
        raise(observation, observation.currentBet + (pot + amountToCall) * size) ??
        call(observation)
      )
    }
    if (realised >= price) return call(observation)
    if (
      headsUp &&
      (holding === 'pair' || holding === 'strong') &&
      realised >= price - tuning.nearIndifferent &&
      rng() < tuning.nearIndifferentCall
    ) {
      return call(observation)
    }
    return legal.fold ? { kind: 'fold' } : call(observation)
  }

  if (realised >= tuning.valueBet[street as Postflop] + multiway) {
    return raise(observation, pot * size) ?? { kind: 'check' }
  }
  if (headsUp) {
    const aggressedPreflop = lastAggressor(actions, 'preflop') === actor.seat
    if (street === 'flop' && aggressedPreflop) {
      const rate = holding === 'draw' ? tuning.continuationDraw : tuning.continuationAir * tilt
      if ((holding === 'air' || holding === 'draw') && rng() < Math.min(1, rate)) {
        return raise(observation, pot * tuning.continuationPot) ?? { kind: 'check' }
      }
    }
    if (holding === 'draw' && street !== 'river' && rng() < Math.min(1, tuning.semiBluff * tilt)) {
      return raise(observation, pot * size) ?? { kind: 'check' }
    }
    if (holding === 'air' && street === 'river' && rng() < Math.min(1, tuning.riverBluff * tilt)) {
      return raise(observation, pot * size) ?? { kind: 'check' }
    }
  }
  return { kind: 'check' }
}

function showdownShare(
  observation: BotObservationV1,
  hole: [BotObservationV1['board'][number], BotObservationV1['board'][number]],
  ranges: readonly PreflopRange[],
): number {
  const { board, street } = observation
  const range = ranges[0] as PreflopRange
  if (street === 'river' && ranges.length === 1) {
    const exact = exactHeadsUpRiverEquity(hole, board)[range]
    if (exact.combinations > 0 && Number.isFinite(exact.potShare)) return exact.potShare
  }
  const seed = `${observation.roomId}:${observation.handNumber}:${street}:${observation.actions?.length ?? 0}`
  return rangedEquity(hole, board, ranges, EQUITY_CORE_TUNING.equityTrials, seed)
}

const RANGE_COMBOS = new Map<PreflopRange, readonly (readonly [Card, Card])[]>()

function combosIn(range: PreflopRange): readonly (readonly [Card, Card])[] {
  const cached = RANGE_COMBOS.get(range)
  if (cached !== undefined) return cached
  const deck = makeDeck()
  const combos: (readonly [Card, Card])[] = []
  for (let first = 0; first < deck.length; first += 1) {
    for (let second = first + 1; second < deck.length; second += 1) {
      const hole = [deck[first] as Card, deck[second] as Card] as const
      if (handIsInPreflopRange(hole, range)) combos.push(hole)
    }
  }
  RANGE_COMBOS.set(range, combos)
  return combos
}

/**
 * Pot share against one hand per opponent, each drawn uniformly from its
 * range's still-possible starting hands, over random completions of the board.
 *
 * Drawing from a precomputed list and redrawing on a clash keeps the draw
 * uniform over legal hands while skipping the full scan of 1,326 starting
 * hands per trial; a range with no legal hand left falls back to any hand.
 */
export function rangedEquity(
  hole: readonly [Card, Card],
  board: readonly Card[],
  ranges: readonly PreflopRange[],
  trials: number,
  seed: string,
): number {
  const random = mulberry32(seedFromString(seed))
  const known = new Set([...hole, ...board].map(cardKey))
  const deck = makeDeck().filter((card) => !known.has(cardKey(card)))
  let total = 0
  for (let trial = 0; trial < trials; trial += 1) {
    const taken = new Set(known)
    const opponents: (readonly [Card, Card])[] = []
    for (const range of ranges) {
      const combos = combosIn(range)
      let picked: readonly [Card, Card] | null = null
      for (let attempt = 0; attempt < 64 && picked === null; attempt += 1) {
        const candidate = combos[Math.floor(random() * combos.length)]
        if (candidate === undefined) break
        if (!taken.has(cardKey(candidate[0])) && !taken.has(cardKey(candidate[1]))) {
          picked = candidate
        }
      }
      if (picked === null) {
        const free = deck.filter((card) => !taken.has(cardKey(card)))
        const first = free.splice(Math.floor(random() * free.length), 1)[0] as Card
        const second = free[Math.floor(random() * free.length)] as Card
        picked = [first, second]
      }
      taken.add(cardKey(picked[0]))
      taken.add(cardKey(picked[1]))
      opponents.push(picked)
    }
    const remaining = deck.filter((card) => !taken.has(cardKey(card)))
    const completed = [...board]
    while (completed.length < 5) {
      completed.push(remaining.splice(Math.floor(random() * remaining.length), 1)[0] as Card)
    }
    const hero = handScore([...hole, ...completed])
    let best = true
    let ties = 1
    for (const other of opponents) {
      const difference = handScore([...other, ...completed]) - hero
      if (difference > 0) {
        best = false
        break
      }
      if (difference === 0) ties += 1
    }
    if (best) total += 1 / ties
  }
  return total / trials
}

function lastAggressor(
  actions: readonly NonNullable<BotObservationV1['actions']>[number][],
  street: Street,
): number | null {
  let highest = 0
  let seat: number | null = null
  for (const entry of actions) {
    if (entry.street !== street) continue
    if (isAggressiveHandAction(entry, highest)) seat = entry.seat
    if (entry.streetBetAfter !== undefined) highest = Math.max(highest, entry.streetBetAfter)
  }
  return seat
}

function actsLast(observation: BotObservationV1, opponentSeats: readonly number[]): boolean {
  const { dealerSeat } = observation
  if (dealerSeat === undefined) return false
  const count = observation.seats.length
  const order = (seat: number) => (seat - dealerSeat - 1 + count) % count
  const mine = order(observation.actor.seat)
  return opponentSeats.every((seat) => order(seat) < mine)
}

function raise(observation: BotObservationV1, target: number): BotDecision | null {
  const { raiseTo, allIn } = observation.legal
  if (raiseTo.enabled && raiseTo.min <= raiseTo.max) {
    return { kind: 'raiseTo', to: Math.min(raiseTo.max, Math.max(raiseTo.min, Math.round(target))) }
  }
  return allIn.enabled ? { kind: 'allIn' } : null
}

function call(observation: BotObservationV1): BotDecision {
  const { legal } = observation
  if (legal.call.enabled) return { kind: 'call' }
  if (legal.check) return { kind: 'check' }
  return legal.allIn.enabled ? { kind: 'allIn' } : { kind: 'fold' }
}
