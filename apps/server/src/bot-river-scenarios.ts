import {
  type BotObservationV1,
  type Card,
  compareRanks,
  evaluateBest,
  HandCategory,
  makeDeck,
  mulberry32,
  seedFromString,
} from '@river/engine'

export type RiverBettorStyle =
  | 'value'
  | 'balanced'
  | 'overbluff'
  | 'pair-pressure'
  | 'pair-disguise'
  | 'polarized'
  | 'camouflaged'
  | 'size-camouflaged'
  | 'reverse-sizing'

export interface RiverPublicBetHistory {
  readonly opportunities: number
  readonly bets: number
  readonly revealedBetCategories?: readonly HandCategory[]
  readonly sizeCounts?: Readonly<{ small: number; medium: number; large: number }>
}

export type RiverRevealSelection = 'uniform' | 'made-biased'

export interface RiverBetTrainingExample {
  readonly category: HandCategory
  readonly bet: boolean
}

export const RIVER_SCENARIO_TUNING = {
  potBeforeBet: 2_000,
  bet: 1_500,
  stackBeforeBet: 20_000,
  balancedHighCardBluffRate: 0.2,
  overbluffHighCardBluffRate: 0.65,
  pairDisguiseBetRate: 0.06,
  polarizedValueBetRate: 0.35,
  polarizedHighCardBluffRate: 0.7,
  camouflagedValueBetRate: 0.77,
  madeBiasedHighCardRevealMultiplier: 0.2,
  madeBiasedPairRevealMultiplier: 1,
  madeBiasedStrongRevealMultiplier: 1.4,
  maximumAttemptsPerScenario: 50,
  historyOpportunities: 24,
} as const

// Exact seven-card category counts: https://oeis.org/A002879
const SEVEN_CARD_CATEGORY_COUNTS: readonly [HandCategory, number][] = [
  [HandCategory.HIGH_CARD, 23_294_460],
  [HandCategory.PAIR, 58_627_800],
  [HandCategory.TWO_PAIR, 31_433_400],
  [HandCategory.THREE_OF_A_KIND, 6_461_620],
  [HandCategory.STRAIGHT, 6_180_020],
  [HandCategory.FLUSH, 4_047_644],
  [HandCategory.FULL_HOUSE, 3_473_184],
  [HandCategory.FOUR_OF_A_KIND, 224_848],
  [HandCategory.STRAIGHT_FLUSH, 41_584],
]
const SEVEN_CARD_HANDS = 133_784_560

function sampleSevenCardCategory(random: () => number): HandCategory {
  let offset = Math.floor(random() * SEVEN_CARD_HANDS)
  for (const [category, count] of SEVEN_CARD_CATEGORY_COUNTS) {
    if (offset < count) return category
    offset -= count
  }
  throw new Error('seven-card category counts do not cover the deck')
}

export interface RiverBettingScenario {
  readonly observation: BotObservationV1
  readonly publicHistory: RiverPublicBetHistory
  readonly oracle: {
    readonly opponentHole: readonly [Card, Card]
    readonly style: RiverBettorStyle
    readonly callPotShare: 0 | 0.5 | 1
  }
}

export function riverBetProbability(style: RiverBettorStyle, category: HandCategory): number {
  if (style === 'pair-pressure') return category >= HandCategory.PAIR ? 1 : 0
  if (style === 'pair-disguise') {
    if (category >= HandCategory.TWO_PAIR) return 1
    return category === HandCategory.PAIR ? RIVER_SCENARIO_TUNING.pairDisguiseBetRate : 0
  }
  if (style === 'polarized') {
    if (category >= HandCategory.TWO_PAIR) return RIVER_SCENARIO_TUNING.polarizedValueBetRate
    return category === HandCategory.HIGH_CARD
      ? RIVER_SCENARIO_TUNING.polarizedHighCardBluffRate
      : 0
  }
  if (style === 'camouflaged' || style === 'size-camouflaged') {
    if (category >= HandCategory.TWO_PAIR) return RIVER_SCENARIO_TUNING.camouflagedValueBetRate
    return category === HandCategory.HIGH_CARD
      ? RIVER_SCENARIO_TUNING.polarizedHighCardBluffRate
      : 0
  }
  if (category >= HandCategory.TWO_PAIR) return 1
  if (style === 'overbluff' && category === HandCategory.PAIR) return 1
  if (category === HandCategory.HIGH_CARD) {
    return style === 'balanced' || style === 'reverse-sizing'
      ? RIVER_SCENARIO_TUNING.balancedHighCardBluffRate
      : style === 'overbluff'
        ? RIVER_SCENARIO_TUNING.overbluffHighCardBluffRate
        : 0
  }
  return 0
}

export function sampleRiverPublicBetHistory(
  style: RiverBettorStyle,
  seed: string,
  opportunities: number,
  revealProbability = 0,
  revealSelection: RiverRevealSelection = 'uniform',
): RiverPublicBetHistory {
  if (!Number.isFinite(revealProbability) || revealProbability < 0 || revealProbability > 1) {
    throw new Error('river reveal probability must be between zero and one')
  }
  const examples = sampleRiverBetTrainingExamples(style, seed, opportunities)
  const bets = examples.filter((example) => example.bet).length
  if (revealProbability === 0) return { opportunities, bets }
  const random = mulberry32(seedFromString(`${seed}:public-reveals`))
  const revealedBetCategories = examples
    .filter((example) => {
      if (!example.bet) return false
      const multiplier =
        revealSelection === 'made-biased'
          ? example.category === HandCategory.HIGH_CARD
            ? RIVER_SCENARIO_TUNING.madeBiasedHighCardRevealMultiplier
            : example.category === HandCategory.PAIR
              ? RIVER_SCENARIO_TUNING.madeBiasedPairRevealMultiplier
              : RIVER_SCENARIO_TUNING.madeBiasedStrongRevealMultiplier
          : 1
      return random() < Math.min(1, revealProbability * multiplier)
    })
    .map((example) => example.category)
  return { opportunities, bets, revealedBetCategories }
}

export function sampleRiverBetTrainingExamples(
  style: RiverBettorStyle,
  seed: string,
  opportunities: number,
): readonly RiverBetTrainingExample[] {
  if (!Number.isSafeInteger(opportunities) || opportunities < 0 || opportunities > 20_000) {
    throw new Error('river history opportunities must be between 0 and 20000')
  }
  const random = mulberry32(seedFromString(seed))
  const examples: RiverBetTrainingExample[] = []
  for (let hand = 0; hand < opportunities; hand += 1) {
    const category = sampleSevenCardCategory(random)
    examples.push({ category, bet: random() < riverBetProbability(style, category) })
  }
  return examples
}

function dealPrefix(random: () => number, count: number): Card[] {
  const deck = makeDeck()
  for (let index = 0; index < count; index += 1) {
    const swap = index + Math.floor(random() * (deck.length - index))
    const card = deck[index]
    deck[index] = deck[swap] as Card
    deck[swap] = card as Card
  }
  return deck.slice(0, count)
}

export function generateRiverBettingScenarios(options: {
  readonly seed: string
  readonly count: number
  readonly style: RiverBettorStyle
  readonly historyOpportunities?: number
  readonly historyRevealProbability?: number
  readonly historyRevealSelection?: RiverRevealSelection
}): readonly RiverBettingScenario[] {
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > 10_000) {
    throw new Error('scenario count must be between 1 and 10000')
  }
  const random = mulberry32(seedFromString(options.seed))
  const scenarios: RiverBettingScenario[] = []
  const tuning = RIVER_SCENARIO_TUNING
  for (
    let attempt = 0;
    scenarios.length < options.count && attempt < options.count * tuning.maximumAttemptsPerScenario;
    attempt += 1
  ) {
    const deck = dealPrefix(random, 9)
    const hero = [deck[0] as Card, deck[1] as Card] as const
    const villain = [deck[2] as Card, deck[3] as Card] as const
    const board = deck.slice(4, 9)
    const villainRank = evaluateBest([...villain, ...board])
    const probability = riverBetProbability(options.style, villainRank.category)
    const bets =
      probability === 1 ||
      (probability < 1 &&
        (villainRank.category === HandCategory.HIGH_CARD ||
          options.style === 'pair-disguise' ||
          options.style === 'polarized' ||
          options.style === 'camouflaged' ||
          options.style === 'size-camouflaged') &&
        random() < probability)
    if (!bets) continue
    const comparison = compareRanks(evaluateBest([...hero, ...board]), villainRank)
    const index = scenarios.length
    const pot = tuning.potBeforeBet + tuning.bet
    scenarios.push({
      publicHistory: sampleRiverPublicBetHistory(
        options.style,
        `${options.seed}:history:${index}`,
        options.historyOpportunities ?? tuning.historyOpportunities,
        options.historyRevealProbability,
        options.historyRevealSelection,
      ),
      observation: {
        version: 1,
        roomId: `offline-river-${options.seed}`,
        handNumber: index + 1,
        actor: {
          playerId: 'hero',
          seat: 0,
          hole: hero,
          stack: tuning.stackBeforeBet,
          betHand: 0,
          betStreet: 0,
        },
        street: 'river',
        board,
        dealerSeat: 0,
        pot,
        currentBet: tuning.bet,
        amountToCall: tuning.bet,
        legal: {
          fold: true,
          check: false,
          call: { enabled: true, amount: tuning.bet },
          raiseTo: { enabled: true, min: tuning.bet * 2, max: tuning.stackBeforeBet },
          allIn: { enabled: true, amount: tuning.stackBeforeBet },
        },
        seats: [
          {
            seat: 0,
            playerId: 'hero',
            stack: tuning.stackBeforeBet,
            betHand: 0,
            betStreet: 0,
            folded: false,
            allIn: false,
            away: false,
          },
          {
            seat: 1,
            playerId: 'villain',
            stack: tuning.stackBeforeBet - tuning.bet,
            betHand: tuning.bet,
            betStreet: tuning.bet,
            folded: false,
            allIn: false,
            away: false,
          },
        ],
        opponents: [],
        actions: [
          {
            seat: 1,
            street: 'river',
            action: { kind: 'raiseTo', to: tuning.bet },
            amountCommitted: tuning.bet,
            potBefore: tuning.potBeforeBet,
            streetBetAfter: tuning.bet,
          },
        ],
        tilt: { factor: 0 },
      },
      oracle: {
        opponentHole: villain,
        style: options.style,
        callPotShare: comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0,
      },
    })
  }
  if (scenarios.length !== options.count) throw new Error('river scenario acceptance exhausted')
  return scenarios
}
