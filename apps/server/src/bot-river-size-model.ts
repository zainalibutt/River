import type { BotObservationV1 } from '@river/engine'
import {
  enumerateRiverBetEvidence,
  RIVER_BET_MODEL_STYLES,
  type RiverBetBucket,
  type RiverBetEvidence,
  type RiverBetHypothesis,
  type RiverBetRateModel,
  type RiverStyleWeights,
  riverBetBucket,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import type { RiverPublicBetHistory } from './bot-river-scenarios.js'
import {
  RIVER_BET_SIZES,
  type RiverBetSize,
  riverBetSizeFromObservation,
  sampleSizedRiverTrainingExamples,
} from './bot-river-size-scenarios.js'

export const RIVER_SIZE_MODEL_TUNING = {
  smoothingPerOutcome: 1,
  outcomesIncludingCheck: 4,
} as const

export interface RiverBetSizeModel {
  readonly base: RiverBetRateModel
  readonly sizeRates: Readonly<Record<RiverBetHypothesis, Readonly<Record<RiverBetSize, number>>>>
  readonly likelihood: Readonly<
    Record<
      RiverBetHypothesis,
      Readonly<Record<RiverBetSize, Readonly<Record<RiverBetBucket, number>>>>
    >
  >
}

export function trainRiverBetSizeModel(seed: string, opportunities = 2_000): RiverBetSizeModel {
  const base = trainRiverBetRateModel(seed, opportunities)
  const fit = (style: RiverBetHypothesis) => {
    const examples = sampleSizedRiverTrainingExamples(style, `${seed}:${style}`, opportunities)
    const counts = {
      highCard: { total: 0, small: 0, medium: 0, large: 0 },
      pair: { total: 0, small: 0, medium: 0, large: 0 },
      made: { total: 0, small: 0, medium: 0, large: 0 },
    }
    const sizeCounts = { small: 0, medium: 0, large: 0 }
    for (const example of examples) {
      const cell = counts[riverBetBucket(example.category)]
      cell.total += 1
      if (example.size !== null) {
        cell[example.size] += 1
        sizeCounts[example.size] += 1
      }
    }
    const likelihood = (size: RiverBetSize) => ({
      highCard:
        (counts.highCard[size] + RIVER_SIZE_MODEL_TUNING.smoothingPerOutcome) /
        (counts.highCard.total + RIVER_SIZE_MODEL_TUNING.outcomesIncludingCheck),
      pair:
        (counts.pair[size] + RIVER_SIZE_MODEL_TUNING.smoothingPerOutcome) /
        (counts.pair.total + RIVER_SIZE_MODEL_TUNING.outcomesIncludingCheck),
      made:
        (counts.made[size] + RIVER_SIZE_MODEL_TUNING.smoothingPerOutcome) /
        (counts.made.total + RIVER_SIZE_MODEL_TUNING.outcomesIncludingCheck),
    })
    const sizeRate = (size: RiverBetSize) =>
      (sizeCounts[size] + RIVER_SIZE_MODEL_TUNING.smoothingPerOutcome) /
      (opportunities + RIVER_SIZE_MODEL_TUNING.outcomesIncludingCheck)
    const sizeRates = {
      small: sizeRate('small'),
      medium: sizeRate('medium'),
      large: sizeRate('large'),
    }
    return {
      likelihood: {
        small: likelihood('small'),
        medium: likelihood('medium'),
        large: likelihood('large'),
      },
      sizeRates,
    }
  }
  const value = fit('value')
  const balanced = fit('balanced')
  const overbluff = fit('overbluff')
  return {
    base,
    sizeRates: {
      value: value.sizeRates,
      balanced: balanced.sizeRates,
      overbluff: overbluff.sizeRates,
    },
    likelihood: {
      value: value.likelihood,
      balanced: balanced.likelihood,
      overbluff: overbluff.likelihood,
    },
  }
}

export function inferRiverStyleWeightsFromSizeHistory(
  model: RiverBetSizeModel,
  history: RiverPublicBetHistory,
): RiverStyleWeights {
  if (history.sizeCounts === undefined) throw new Error('public bet sizes are missing')
  const { small, medium, large } = history.sizeCounts
  if (
    !Number.isSafeInteger(history.opportunities) ||
    !Number.isSafeInteger(history.bets) ||
    ![small, medium, large].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    history.opportunities < history.bets ||
    small + medium + large !== history.bets
  ) {
    throw new Error('public bet size counts must match prior opportunities')
  }
  const scores = RIVER_BET_MODEL_STYLES.map((style) => {
    const rates = model.sizeRates[style]
    const checkRate = 1 - rates.small - rates.medium - rates.large
    if (!(checkRate > 0 && RIVER_BET_SIZES.every((size) => rates[size] > 0))) {
      throw new Error('invalid learned public size rates')
    }
    return (
      (history.opportunities - history.bets) * Math.log(checkRate) +
      small * Math.log(rates.small) +
      medium * Math.log(rates.medium) +
      large * Math.log(rates.large)
    )
  })
  const maximum = Math.max(...scores)
  const weights = scores.map((score) => Math.exp(score - maximum))
  const total = weights.reduce((sum, value) => sum + value, 0)
  return {
    value: (weights[0] as number) / total,
    balanced: (weights[1] as number) / total,
    overbluff: (weights[2] as number) / total,
  }
}

export function enumerateSizedRiverBetEvidence(
  observation: BotObservationV1,
  model: RiverBetSizeModel,
): RiverBetEvidence | null {
  const size = riverBetSizeFromObservation(observation)
  if (size === null) return null
  const likelihoodByBucket = {
    value: model.likelihood.value[size],
    balanced: model.likelihood.balanced[size],
    overbluff: model.likelihood.overbluff[size],
  }
  return enumerateRiverBetEvidence(observation, {
    ...model.base,
    likelihoodByBucket,
  })
}
