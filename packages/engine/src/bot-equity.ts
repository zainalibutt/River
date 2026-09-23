import { type Card, cardKey, makeDeck, rankValue } from './cards.js'
import { SEATS_PER_SHAPE } from './config.js'
import { compareRanks, evaluateBest } from './evaluator.js'
import { mulberry32, seedFromString } from './rng.js'

export const BOT_EQUITY_TUNING = {
  defaultTrials: 1_000,
  maximumTrials: 10_000,
} as const

export type PreflopRange = 'random' | 'loose' | 'tight' | 'premium'

export interface ShowdownEquityOptions {
  readonly hole: readonly [Card, Card]
  readonly board?: readonly Card[]
  readonly opponents: number
  readonly seed: string
  readonly trials?: number
  readonly ranges?: readonly PreflopRange[]
}

export type PreflopEquityOptions = Omit<ShowdownEquityOptions, 'board'>

export interface PreflopEquityResult {
  readonly trials: number
  readonly opponents: number
  readonly outrightWins: number
  readonly tiedWins: number
  readonly losses: number
  readonly potShare: number
}

export type RiverRangeShares = Readonly<
  Record<PreflopRange, { readonly combinations: number; readonly potShare: number }>
>

export function exactHeadsUpRiverEquity(
  hole: readonly [Card, Card],
  board: readonly Card[],
): RiverRangeShares {
  if (board.length !== 5) throw new Error('exact river equity requires five board cards')
  const knownCards = [...hole, ...board]
  if (new Set(knownCards.map(cardKey)).size !== knownCards.length) {
    throw new Error('known hole and board cards must be distinct')
  }
  const known = new Set(knownCards.map(cardKey))
  const available = makeDeck().filter((card) => !known.has(cardKey(card)))
  const hero = evaluateBest(knownCards)
  const ranges = ['random', 'loose', 'tight', 'premium'] as const
  const totals = { random: 0, loose: 0, tight: 0, premium: 0 }
  const counts = { random: 0, loose: 0, tight: 0, premium: 0 }
  for (let first = 0; first < available.length - 1; first += 1) {
    for (let second = first + 1; second < available.length; second += 1) {
      const otherHole = [available[first] as Card, available[second] as Card] as const
      const comparison = compareRanks(hero, evaluateBest([...otherHole, ...board]))
      const share = comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0
      for (const range of ranges) {
        if (!handIsInPreflopRange(otherHole, range)) continue
        totals[range] += share
        counts[range] += 1
      }
    }
  }
  return {
    random: { combinations: counts.random, potShare: totals.random / counts.random },
    loose: { combinations: counts.loose, potShare: totals.loose / counts.loose },
    tight: { combinations: counts.tight, potShare: totals.tight / counts.tight },
    premium: { combinations: counts.premium, potShare: totals.premium / counts.premium },
  }
}

export function handIsInPreflopRange(hole: readonly [Card, Card], range: PreflopRange): boolean {
  const high = Math.max(rankValue(hole[0].rank), rankValue(hole[1].rank))
  const low = Math.min(rankValue(hole[0].rank), rankValue(hole[1].rank))
  const pair = high === low
  const suited = hole[0].suit === hole[1].suit
  if (range === 'random') return true
  if (range === 'premium')
    return (
      (pair && high >= 10) || (high === 14 && low >= 12 && suited) || (high === 14 && low === 13)
    )
  if (range === 'tight') {
    return (
      (pair && high >= 8) ||
      (high === 14 && low >= 10 && suited) ||
      (high === 14 && low >= 11) ||
      (high === 13 && low === 12 && suited) ||
      (high === 13 && low === 12)
    )
  }
  if (range === 'loose') {
    return (
      pair ||
      high === 14 ||
      (suited && high - low <= 2 && low >= 4) ||
      (suited && low >= 10) ||
      (high >= 13 && low >= 10)
    )
  }
  return false
}

export function estimatePreflopEquity(options: PreflopEquityOptions): PreflopEquityResult {
  return estimateShowdownEquity(options)
}

export function estimateShowdownEquity(options: ShowdownEquityOptions): PreflopEquityResult {
  const { hole, opponents, seed, ranges } = options
  const knownBoard = options.board ?? []
  const trials = options.trials ?? BOT_EQUITY_TUNING.defaultTrials
  if (!Number.isSafeInteger(opponents) || opponents < 1 || opponents >= SEATS_PER_SHAPE.full) {
    throw new Error(`opponents must be between 1 and ${SEATS_PER_SHAPE.full - 1}`)
  }
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > BOT_EQUITY_TUNING.maximumTrials) {
    throw new Error(`trials must be between 1 and ${BOT_EQUITY_TUNING.maximumTrials}`)
  }
  if (
    ranges !== undefined &&
    (ranges.length !== opponents ||
      ranges.some((range) => !['random', 'loose', 'tight', 'premium'].includes(range)))
  ) {
    throw new Error('ranges must name one supported hand range per opponent')
  }
  if (
    knownBoard.length !== 0 &&
    knownBoard.length !== 3 &&
    knownBoard.length !== 4 &&
    knownBoard.length !== 5
  ) {
    throw new Error('board must have 0, 3, 4 or 5 cards')
  }
  const knownCards = [...hole, ...knownBoard]
  if (new Set(knownCards.map(cardKey)).size !== knownCards.length) {
    throw new Error('known hole and board cards must be distinct')
  }

  const known = new Set(knownCards.map(cardKey))
  const available = makeDeck().filter((card) => !known.has(cardKey(card)))
  const random = mulberry32(seedFromString(seed))
  const cardsNeeded = opponents * 2 + 5 - knownBoard.length
  let outrightWins = 0
  let tiedWins = 0
  let losses = 0
  let totalShare = 0

  for (let trial = 0; trial < trials; trial += 1) {
    const deck = [...available]
    if (ranges !== undefined) {
      for (let opponent = 0; opponent < opponents; opponent += 1) {
        const range = ranges[opponent] as PreflopRange
        let choices = 0
        let selected = -1
        for (let first = opponent * 2; first < deck.length - 1; first += 1) {
          for (let second = first + 1; second < deck.length; second += 1) {
            if (!handIsInPreflopRange([deck[first] as Card, deck[second] as Card], range)) continue
            choices += 1
            if (random() * choices < 1) selected = first * deck.length + second
          }
        }
        if (selected < 0)
          throw new Error(`no compatible ${range} hands remain for opponent ${opponent + 1}`)
        const first = Math.floor(selected / deck.length)
        const second = selected % deck.length
        const start = opponent * 2
        const firstCard = deck[first] as Card
        deck[first] = deck[start] as Card
        deck[start] = firstCard
        const secondCard = deck[second] as Card
        deck[second] = deck[start + 1] as Card
        deck[start + 1] = secondCard
      }
    }
    for (let index = ranges === undefined ? 0 : opponents * 2; index < cardsNeeded; index += 1) {
      const swap = index + Math.floor(random() * (deck.length - index))
      const card = deck[index]
      deck[index] = deck[swap] as Card
      deck[swap] = card as Card
    }
    const board = [...knownBoard, ...deck.slice(opponents * 2, cardsNeeded)]
    const hero = evaluateBest([...hole, ...board])
    let stronger = false
    let winners = 1
    for (let opponent = 0; opponent < opponents; opponent += 1) {
      const other = evaluateBest([
        deck[opponent * 2] as Card,
        deck[opponent * 2 + 1] as Card,
        ...board,
      ])
      const comparison = compareRanks(other, hero)
      if (comparison > 0) {
        stronger = true
        break
      }
      if (comparison === 0) winners += 1
    }
    if (stronger) losses += 1
    else if (winners === 1) {
      outrightWins += 1
      totalShare += 1
    } else {
      tiedWins += 1
      totalShare += 1 / winners
    }
  }

  return { trials, opponents, outrightWins, tiedWins, losses, potShare: totalShare / trials }
}
