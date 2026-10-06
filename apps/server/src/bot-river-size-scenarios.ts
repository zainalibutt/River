import {
  type BotObservationV1,
  evaluateBest,
  type HandCategory,
  mulberry32,
  PUBLIC_BET_SIZE_TUNING,
  seedFromString,
} from '@river/engine'
import { type RiverBetBucket, riverBetBucket } from './bot-river-bet-model.js'
import {
  generateRiverBettingScenarios,
  type RiverBettingScenario,
  type RiverBettorStyle,
  sampleRiverBetTrainingExamples,
} from './bot-river-scenarios.js'

export type RiverBetSize = 'small' | 'medium' | 'large'
export const RIVER_BET_SIZES: readonly RiverBetSize[] = ['small', 'medium', 'large']

export const RIVER_SIZE_TUNING = {
  potBeforeBet: 2_000,
  stackBeforeBet: 20_000,
  smallPotRatio: 0.35,
  mediumPotRatio: 0.75,
  largePotRatio: 1.25,
  smallUpperRatio: PUBLIC_BET_SIZE_TUNING.smallUpperRatio,
  mediumUpperRatio: PUBLIC_BET_SIZE_TUNING.mediumUpperRatio,
  typicalMade: [0.1, 0.5, 0.4],
  typicalBluff: [0.15, 0.8, 0.05],
  loosePair: [0.7, 0.25, 0.05],
  polarizedMade: [0.05, 0.2, 0.75],
  polarizedBluff: [0.8, 0.15, 0.05],
  camouflagedSizes: [0.1, 0.53, 0.37],
  reverseBluff: [0.05, 0.15, 0.8],
  reverseMade: [0.8, 0.15, 0.05],
} as const

export interface SizedRiverTrainingExample {
  readonly category: HandCategory
  readonly size: RiverBetSize | null
}

export function sizeProbabilities(
  style: RiverBettorStyle,
  bucket: RiverBetBucket,
): readonly number[] {
  if (style === 'size-camouflaged') return RIVER_SIZE_TUNING.camouflagedSizes
  if (style === 'reverse-sizing') {
    return bucket === 'highCard' ? RIVER_SIZE_TUNING.reverseBluff : RIVER_SIZE_TUNING.reverseMade
  }
  if (style === 'polarized') {
    return bucket === 'highCard'
      ? RIVER_SIZE_TUNING.polarizedBluff
      : RIVER_SIZE_TUNING.polarizedMade
  }
  if (bucket === 'pair') return RIVER_SIZE_TUNING.loosePair
  return bucket === 'highCard' ? RIVER_SIZE_TUNING.typicalBluff : RIVER_SIZE_TUNING.typicalMade
}

function sampleBetSize(
  style: RiverBettorStyle,
  category: HandCategory,
  random: () => number,
): RiverBetSize {
  const probabilities = sizeProbabilities(style, riverBetBucket(category))
  const draw = random()
  if (draw < (probabilities[0] as number)) return 'small'
  if (draw < (probabilities[0] as number) + (probabilities[1] as number)) return 'medium'
  return 'large'
}

export function sampleSizedRiverTrainingExamples(
  style: RiverBettorStyle,
  seed: string,
  opportunities: number,
): readonly SizedRiverTrainingExample[] {
  const examples = sampleRiverBetTrainingExamples(style, seed, opportunities)
  const random = mulberry32(seedFromString(`${seed}:sizes`))
  return examples.map((example) => ({
    category: example.category,
    size: example.bet ? sampleBetSize(style, example.category, random) : null,
  }))
}

export function sampleRiverPublicSizeCounts(
  style: RiverBettorStyle,
  seed: string,
  opportunities: number,
): Readonly<{ small: number; medium: number; large: number }> {
  const counts = { small: 0, medium: 0, large: 0 }
  for (const example of sampleSizedRiverTrainingExamples(style, seed, opportunities)) {
    if (example.size !== null) counts[example.size] += 1
  }
  return counts
}

export function riverBetSizeFromObservation(observation: BotObservationV1): RiverBetSize | null {
  const last = observation.actions?.filter((action) => action.street === 'river').at(-1)
  if (
    last === undefined ||
    last.action.kind !== 'raiseTo' ||
    last.amountCommitted === undefined ||
    last.potBefore === undefined ||
    last.potBefore <= 0
  ) {
    return null
  }
  return riverBetSizeFromRatio(last.amountCommitted / last.potBefore)
}

export function riverBetSizeFromRatio(ratio: number): RiverBetSize | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null
  if (ratio <= RIVER_SIZE_TUNING.smallUpperRatio) return 'small'
  return ratio <= RIVER_SIZE_TUNING.mediumUpperRatio ? 'medium' : 'large'
}

export function generateSizedRiverScenarios(options: {
  readonly seed: string
  readonly count: number
  readonly style: RiverBettorStyle
}): readonly RiverBettingScenario[] {
  const base = generateRiverBettingScenarios(options)
  return base.map((scenario, index) => {
    const { observation, oracle } = scenario
    const sizeCounts = sampleRiverPublicSizeCounts(
      options.style,
      `${options.seed}:history:${index}`,
      scenario.publicHistory.opportunities,
    )
    const category = evaluateBest([...oracle.opponentHole, ...observation.board]).category
    const random = mulberry32(seedFromString(`${options.seed}:size:${index}`))
    const size = sampleBetSize(options.style, category, random)
    const ratio =
      size === 'small'
        ? RIVER_SIZE_TUNING.smallPotRatio
        : size === 'medium'
          ? RIVER_SIZE_TUNING.mediumPotRatio
          : RIVER_SIZE_TUNING.largePotRatio
    const bet = Math.round(RIVER_SIZE_TUNING.potBeforeBet * ratio)
    return {
      ...scenario,
      publicHistory: { ...scenario.publicHistory, sizeCounts },
      observation: {
        ...observation,
        pot: RIVER_SIZE_TUNING.potBeforeBet + bet,
        currentBet: bet,
        amountToCall: bet,
        legal: {
          ...observation.legal,
          call: { enabled: true, amount: bet },
          raiseTo: { enabled: true, min: bet * 2, max: RIVER_SIZE_TUNING.stackBeforeBet },
        },
        seats: observation.seats.map((seat) =>
          seat.seat === 1
            ? {
                ...seat,
                stack: RIVER_SIZE_TUNING.stackBeforeBet - bet,
                betHand: bet,
                betStreet: bet,
              }
            : seat,
        ),
        actions: [
          {
            seat: 1,
            street: 'river',
            action: { kind: 'raiseTo', to: bet },
            amountCommitted: bet,
            potBefore: RIVER_SIZE_TUNING.potBeforeBet,
            streetBetAfter: bet,
          },
        ],
      },
    }
  })
}
