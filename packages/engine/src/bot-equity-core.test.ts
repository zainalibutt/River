import { describe, expect, it } from 'vitest'
import { estimateShowdownEquity, handIsInPreflopRange, type PreflopRange } from './bot-equity.js'
import { bluffMultiplier, equityCoreDecision, rangedEquity } from './bot-equity-core.js'
import type { BotObservationV1 } from './bots.js'
import { type Card, cardKey, makeDeck, parseCard, RANKS, rankValue, SUITS } from './cards.js'
import { BOT_PROFILES } from './config.js'
import { handScore } from './fast-evaluator.js'
import { mulberry32, seedFromString } from './rng.js'

const cards = (text: string) => text.split(' ').map(parseCard)

function spot(options: {
  hole: string
  board: string
  street: BotObservationV1['street']
  facing: number
  opponents?: number
}): BotObservationV1 {
  const others = options.opponents ?? 1
  const pot = 6_000 + options.facing
  return {
    version: 1,
    roomId: 'equity-core',
    handNumber: 3,
    actor: {
      playerId: 'bot:kazimir',
      seat: 0,
      hole: cards(options.hole),
      stack: 60_000,
      betHand: 3_000,
      betStreet: 0,
    },
    street: options.street,
    board: cards(options.board),
    dealerSeat: others,
    pot,
    currentBet: options.facing,
    amountToCall: options.facing,
    legal: {
      fold: options.facing > 0,
      check: options.facing === 0,
      call: { enabled: options.facing > 0, amount: options.facing },
      raiseTo: { enabled: true, min: Math.max(500, options.facing * 2), max: 60_000 },
      allIn: { enabled: true, amount: 60_000 },
    },
    seats: Array.from({ length: others + 1 }, (_, seat) => ({
      seat,
      playerId: seat === 0 ? 'bot:kazimir' : `bot:other-${seat}`,
      stack: 60_000,
      betHand: 3_000 + (seat === 0 ? 0 : options.facing),
      betStreet: seat === 0 ? 0 : options.facing,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    actions:
      options.facing > 0
        ? [
            {
              seat: 1,
              street: options.street,
              action: { kind: 'raiseTo', to: options.facing },
              amountCommitted: options.facing,
              potBefore: 6_000,
              streetBetAfter: options.facing,
            },
          ]
        : [],
    tilt: { factor: 0 },
  }
}

const river = 'Kh 9d 5c 2s 3h'
const decisions = (observation: BotObservationV1, bluffRate = 0.35, seeds = 200) =>
  Array.from({ length: seeds }, (_, seed) =>
    equityCoreDecision(observation, { ...BOT_PROFILES.og, bluffRate }, mulberry32(seed)),
  )
const share = (list: ReturnType<typeof decisions>, kinds: readonly string[]) =>
  list.filter((decision) => decision !== null && kinds.includes(decision.kind)).length / list.length

describe('equity core for an OG after the flop', () => {
  it('never folds a set on the river and folds air to a bet', () => {
    expect(
      share(decisions(spot({ hole: 'Ks Kd', board: river, street: 'river', facing: 3_000 })), [
        'fold',
      ]),
    ).toBe(0)
    expect(
      share(decisions(spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 3_000 })), [
        'fold',
      ]),
    ).toBe(1)
  })

  it('value-bets two pair when checked to', () => {
    expect(
      share(decisions(spot({ hole: 'Ks 9c', board: river, street: 'river', facing: 0 })), [
        'raiseTo',
      ]),
    ).toBe(1)
  })

  it('bluffs air on the river heads-up at a rate its character tilts within bounds', () => {
    const air = spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 0 })
    const balanced = share(decisions(air, 0.35, 300), ['raiseTo'])
    const bold = share(decisions(air, 0.45, 300), ['raiseTo'])
    const shy = share(decisions(air, 0.1, 300), ['raiseTo'])
    expect(balanced).toBeGreaterThan(0.28)
    expect(balanced).toBeLessThan(0.42)
    expect(bold).toBeGreaterThan(balanced)
    expect(shy).toBeLessThan(balanced)
    expect(shy).toBeGreaterThan(0.15)
    expect(bluffMultiplier({ bluffRate: 5 })).toBe(1.4)
    expect(bluffMultiplier({ bluffRate: 0 })).toBe(0.6)
  }, 30_000)

  it('does not bluff into two opponents', () => {
    const air = spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 0, opponents: 2 })
    expect(share(decisions(air), ['raiseTo'])).toBe(0)
  })

  it('continues with a flush draw at a good price on the flop', () => {
    const draw = spot({ hole: 'Ah 4h', board: 'Kh 9h 2c', street: 'flop', facing: 1_000 })
    expect(share(decisions(draw), ['fold'])).toBe(0)
  })

  it('leaves preflop to the rule policy', () => {
    const preflop = {
      ...spot({ hole: 'As Ad', board: 'Kh 9d 5c', street: 'flop', facing: 500 }),
      street: 'preflop' as const,
      board: [],
    }
    expect(equityCoreDecision(preflop, BOT_PROFILES.og, mulberry32(1))).toBeNull()
  })
})

describe('fast ranged equity', () => {
  it('agrees with the reference estimator on the same spot', () => {
    const hole = cards('As Kd') as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>]
    const board = cards('Qs Js 2c')
    for (const ranges of [['tight'], ['loose', 'random']] as const) {
      const fast = rangedEquity(hole, board, ranges, 4_000, 'agree')
      const reference = estimateShowdownEquity({
        hole,
        board,
        opponents: ranges.length,
        seed: 'agree',
        trials: 4_000,
        ranges,
      }).potShare
      expect(Math.abs(fast - reference)).toBeLessThan(0.03)
    }
  }, 30_000)
})

/** `rangedEquity` as it was before card masks, kept to prove the faster draw is the same draw. */
function referenceRangedEquity(
  hole: readonly [Card, Card],
  board: readonly Card[],
  ranges: readonly PreflopRange[],
  trials: number,
  seed: string,
): number {
  const key = (card: Card) => SUITS.indexOf(card.suit) * 13 + RANKS.indexOf(card.rank)
  const random = mulberry32(seedFromString(seed))
  const known = new Set([...hole, ...board].map(key))
  const deck = makeDeck().filter((card) => !known.has(key(card)))
  const everyHand = makeDeck().flatMap((first, index, all) =>
    all.slice(index + 1).map((second) => [first, second] as const),
  )
  const combosFor = (range: PreflopRange) =>
    everyHand.filter((candidate) => handIsInPreflopRange(candidate, range))
  let total = 0
  for (let trial = 0; trial < trials; trial += 1) {
    const taken = new Set(known)
    const opponents: (readonly [Card, Card])[] = []
    for (const range of ranges) {
      const combos = combosFor(range)
      let picked: readonly [Card, Card] | null = null
      for (let attempt = 0; attempt < 64 && picked === null; attempt += 1) {
        const candidate = combos[Math.floor(random() * combos.length)]
        if (candidate === undefined) break
        if (!taken.has(key(candidate[0])) && !taken.has(key(candidate[1]))) picked = candidate
      }
      if (picked === null) {
        const free = deck.filter((card) => !taken.has(key(card)))
        const first = free.splice(Math.floor(random() * free.length), 1)[0] as Card
        const second = free[Math.floor(random() * free.length)] as Card
        picked = [first, second]
      }
      taken.add(key(picked[0]))
      taken.add(key(picked[1]))
      opponents.push(picked)
    }
    const remaining = deck.filter((card) => !taken.has(key(card)))
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

describe('the ranged equity draw', () => {
  it('gives exactly the shares of the draw it replaced, on random spots', () => {
    const random = mulberry32(seedFromString('equity-parity'))
    const names: readonly PreflopRange[] = ['random', 'loose', 'tight', 'premium']
    for (let spot = 0; spot < 400; spot += 1) {
      const deck = makeDeck()
      const draw = () => deck.splice(Math.floor(random() * deck.length), 1)[0] as Card
      const hole: [Card, Card] = [draw(), draw()]
      const board = Array.from({ length: [0, 3, 4, 5][spot % 4] as number }, draw)
      const ranges = Array.from(
        { length: 1 + (spot % 3) },
        () => names[Math.floor(random() * names.length)] as PreflopRange,
      )
      const trials = spot % 2 === 0 ? 40 : 120
      const seed = `parity:${spot}`
      expect(rangedEquity(hole, board, ranges, trials, seed)).toBe(
        referenceRangedEquity(hole, board, ranges, trials, seed),
      )
    }
  }, 120_000)

  it('numbers cards and ranks as before', () => {
    for (const card of makeDeck()) {
      expect(cardKey(card)).toBe(SUITS.indexOf(card.suit) * 13 + RANKS.indexOf(card.rank))
      expect(rankValue(card.rank)).toBe(RANKS.indexOf(card.rank) + 2)
    }
  })
})
