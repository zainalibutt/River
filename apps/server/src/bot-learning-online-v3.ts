import type { LearningExampleV1, LearningLabel } from './bot-learning-data.js'
import {
  ACTION_LABELS,
  type ActionMetrics,
  type ActionModelV1,
  type ActionProbabilities,
  BOT_LEARNING_TUNING,
  predictAction,
  scoreActionPredictions,
} from './bot-learning-model.js'

export interface OnlineForecastTuning {
  readonly minimumSamples: number
  readonly advantageMargin: number
  readonly learningRate: number
  readonly evidenceDecay: number
  readonly maximumCandidateWeight: number
}

export const ONLINE_FORECAST_TUNING_V3: OnlineForecastTuning = {
  minimumSamples: 4,
  advantageMargin: 3,
  learningRate: 0.2,
  evidenceDecay: 0.98,
  maximumCandidateWeight: 0.9,
}

interface ActorEvidence {
  samples: number
  candidateAdvantage: number
}

export interface OnlineForecast {
  readonly actorId: string
  readonly legalLabels: readonly LearningLabel[]
  readonly probabilities: ActionProbabilities
  readonly frozen: ActionProbabilities
  readonly candidate: ActionProbabilities
  readonly candidateWeight: number
}

export class OnlineActionForecaster {
  private readonly evidence = new Map<string, ActorEvidence>()
  private readonly consumed = new WeakSet<OnlineForecast>()

  constructor(
    private readonly frozenModel: ActionModelV1,
    private readonly candidateModel: ActionModelV1,
    private readonly tuning: OnlineForecastTuning = ONLINE_FORECAST_TUNING_V3,
  ) {
    if (frozenModel.featureSchemaVersion !== 2 || candidateModel.featureSchemaVersion !== 2) {
      throw new Error('online forecast needs two schema-two models')
    }
    if (
      !Number.isSafeInteger(tuning.minimumSamples) ||
      tuning.minimumSamples < 0 ||
      !Number.isFinite(tuning.advantageMargin) ||
      tuning.advantageMargin < 0 ||
      !Number.isFinite(tuning.learningRate) ||
      tuning.learningRate <= 0 ||
      !Number.isFinite(tuning.evidenceDecay) ||
      tuning.evidenceDecay <= 0 ||
      tuning.evidenceDecay > 1 ||
      !Number.isFinite(tuning.maximumCandidateWeight) ||
      tuning.maximumCandidateWeight <= 0 ||
      tuning.maximumCandidateWeight > 1
    ) {
      throw new Error('invalid online forecast tuning')
    }
  }

  forecast(
    actorId: string,
    features: readonly number[],
    legalLabels: readonly LearningLabel[],
  ): OnlineForecast {
    if (actorId.length === 0) throw new Error('forecast actor missing')
    const frozen = predictAction(this.frozenModel, features, legalLabels)
    const candidate = predictAction(this.candidateModel, features, legalLabels)
    const actor = this.evidence.get(actorId)
    const weight =
      actor === undefined ||
      actor.samples < this.tuning.minimumSamples ||
      actor.candidateAdvantage <= this.tuning.advantageMargin
        ? 0
        : Math.min(
            this.tuning.maximumCandidateWeight,
            1 -
              Math.exp(
                -this.tuning.learningRate *
                  (actor.candidateAdvantage - this.tuning.advantageMargin),
              ),
          )
    const probabilities = Object.fromEntries(
      ACTION_LABELS.map((label) => [
        label,
        (1 - weight) * frozen[label] + weight * candidate[label],
      ]),
    ) as unknown as ActionProbabilities
    return {
      actorId,
      legalLabels: [...legalLabels],
      probabilities,
      frozen,
      candidate,
      candidateWeight: weight,
    }
  }

  observe(forecast: OnlineForecast, acceptedLabel: LearningLabel): void {
    if (this.consumed.has(forecast)) throw new Error('forecast action already observed')
    if (!forecast.legalLabels.includes(acceptedLabel))
      throw new Error('observed action must be legal')
    this.consumed.add(forecast)
    const previous = this.evidence.get(forecast.actorId) ?? { samples: 0, candidateAdvantage: 0 }
    const advantage =
      Math.log(Math.max(BOT_LEARNING_TUNING.probabilityFloor, forecast.candidate[acceptedLabel])) -
      Math.log(Math.max(BOT_LEARNING_TUNING.probabilityFloor, forecast.frozen[acceptedLabel]))
    this.evidence.set(forecast.actorId, {
      samples: previous.samples + 1,
      candidateAdvantage:
        previous.candidateAdvantage * this.tuning.evidenceDecay +
        Math.max(-3, Math.min(3, advantage)),
    })
  }

  forgetActor(actorId: string): void {
    this.evidence.delete(actorId)
  }
}

export function scoreOnlineActionForecaster(
  frozen: ActionModelV1,
  candidate: ActionModelV1,
  examples: readonly LearningExampleV1[],
  tuning: OnlineForecastTuning = ONLINE_FORECAST_TUNING_V3,
): {
  readonly metrics: ActionMetrics
  readonly adaptedForecasts: number
  readonly totalForecasts: number
  readonly pairedLogLoss: {
    readonly improvement: number
    readonly confidence95: readonly [number, number] | null
    readonly hands: number
  }
} {
  const forecaster = new OnlineActionForecaster(frozen, candidate, tuning)
  let adaptedForecasts = 0
  let improvementTotal = 0
  const byHand = new Map<string, { sum: number; count: number }>()
  const metrics = scoreActionPredictions(examples, (example) => {
    const forecast = forecaster.forecast(example.actorId, example.features, example.legalLabels)
    if (forecast.candidateWeight > 0) adaptedForecasts += 1
    const improvement =
      Math.log(
        Math.max(BOT_LEARNING_TUNING.probabilityFloor, forecast.probabilities[example.label]),
      ) - Math.log(Math.max(BOT_LEARNING_TUNING.probabilityFloor, forecast.frozen[example.label]))
    improvementTotal += improvement
    const hand = byHand.get(example.handId) ?? { sum: 0, count: 0 }
    hand.sum += improvement
    hand.count += 1
    byHand.set(example.handId, hand)
    forecaster.observe(forecast, example.label)
    return forecast.probabilities
  })
  const meanImprovement = improvementTotal / examples.length
  const hands = [...byHand.values()]
  const squaredInfluence = hands.reduce(
    (sum, hand) => sum + (hand.sum - meanImprovement * hand.count) ** 2,
    0,
  )
  const radius =
    hands.length < 2
      ? null
      : (1.96 * Math.sqrt((hands.length / (hands.length - 1)) * squaredInfluence)) / examples.length
  return {
    metrics,
    adaptedForecasts,
    totalForecasts: examples.length,
    pairedLogLoss: {
      improvement: meanImprovement,
      confidence95: radius === null ? null : [meanImprovement - radius, meanImprovement + radius],
      hands: hands.length,
    },
  }
}
