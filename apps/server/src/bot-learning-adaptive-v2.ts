import type { LearningExampleV1, LearningLabel } from './bot-learning-data.js'
import { ACTOR_HISTORY_COUNT_SCALE_V2, LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import {
  type ActionModelV1,
  type ActionProbabilities,
  predictAction,
} from './bot-learning-model.js'

export const ADAPTIVE_PRIORS_V2 = [4, 8, 12, 24, 48] as const

const facingIndex = LEARNING_FEATURES_V2.indexOf('facing_bet')
const facingCountIndex = LEARNING_FEATURES_V2.indexOf('actor_facing_bet_sample_count')
const freeCountIndex = LEARNING_FEATURES_V2.indexOf('actor_free_action_sample_count')

export function predictAdaptiveActionV2(
  model: ActionModelV1,
  example: LearningExampleV1,
  prior: number,
): ActionProbabilities {
  if (model.featureSchemaVersion !== 2) throw new Error('adaptive forecast needs schema two')
  if (!Number.isFinite(prior) || prior <= 0) throw new Error('invalid adaptive prior')
  const base = predictAction(model, example.features, example.legalLabels)
  const facing = example.features[facingIndex]
  if (facing !== 0 && facing !== 1) throw new Error('invalid facing context')
  const countFeature = example.features[facing === 1 ? facingCountIndex : freeCountIndex]
  if (countFeature === undefined || countFeature >= 1) {
    throw new Error('invalid actor sample count')
  }
  const samples = (ACTOR_HISTORY_COUNT_SCALE_V2 * countFeature) / (1 - countFeature)
  if (samples === 0) return base
  const context = facing === 1 ? 'actor_facing_bet_' : 'actor_free_action_'
  const raw = Object.fromEntries(
    (['fold', 'check', 'call', 'raise'] as const).map((label) => {
      const index = LEARNING_FEATURES_V2.indexOf(`${context}${label}_smoothed_rate`)
      return [label, index >= 0 ? example.features[index] : 0]
    }),
  ) as Record<LearningLabel, number>
  const legal = example.legalLabels
  const total = legal.reduce((sum, label) => sum + raw[label], 0)
  if (!(total > 0)) throw new Error('invalid actor action history')
  const weight = samples / (samples + prior)
  return {
    fold: blend('fold'),
    check: blend('check'),
    call: blend('call'),
    raise: blend('raise'),
  }

  function blend(label: LearningLabel): number {
    if (!legal.includes(label)) return 0
    return (1 - weight) * base[label] + weight * (raw[label] / total)
  }
}
