import { type BenchmarkOptions, runBotBenchmark } from './bot-benchmark.js'
import {
  extractLearningFeaturesV1,
  LEARNING_FEATURES_V1,
  type LearningExampleV1,
  type LearningLabel,
  labelFor,
  legalLabelsFor,
} from './bot-learning-data.js'

export const LEARNING_FEATURES_V2: readonly string[] = [
  ...LEARNING_FEATURES_V1,
  'actor_facing_bet_sample_count',
  'actor_facing_bet_fold_smoothed_rate',
  'actor_facing_bet_call_smoothed_rate',
  'actor_facing_bet_raise_smoothed_rate',
  'actor_free_action_sample_count',
  'actor_free_action_fold_smoothed_rate',
  'actor_free_action_check_smoothed_rate',
  'actor_free_action_raise_smoothed_rate',
] as const

export const ACTOR_HISTORY_COUNT_SCALE_V2 = 4

interface ActorHistory {
  facing: { fold: number; call: number; raise: number }
  free: { fold: number; check: number; raise: number }
}

export class CausalActionHistoryV2 {
  private readonly byActor = new Map<string, ActorHistory>()

  features(actorId: string): readonly number[] {
    return historyFeatures(this.byActor.get(actorId) ?? emptyHistory())
  }

  observe(actorId: string, facingBet: boolean, label: LearningLabel): void {
    const history = this.byActor.get(actorId) ?? emptyHistory()
    updateHistory(history, facingBet, label)
    this.byActor.set(actorId, history)
  }

  forget(actorId: string): void {
    this.byActor.delete(actorId)
  }
}

function emptyHistory(): ActorHistory {
  return {
    facing: { fold: 0, call: 0, raise: 0 },
    free: { fold: 0, check: 0, raise: 0 },
  }
}

export function collectLearningExamplesV2(options: BenchmarkOptions): readonly LearningExampleV1[] {
  const examples: LearningExampleV1[] = []
  const history = new CausalActionHistoryV2()
  runBotBenchmark({
    ...options,
    onDecision(decision) {
      const { observation, action, handIndex, actorId } = decision
      const legalLabels = legalLabelsFor(observation)
      const label = labelFor(action, observation)
      if (!legalLabels.includes(label)) {
        throw new Error(`benchmark action has no legal learning label: ${action.kind}`)
      }
      const features = [...extractLearningFeaturesV1(observation), ...history.features(actorId)]
      if (features.length !== LEARNING_FEATURES_V2.length) {
        throw new Error('learning v2 feature order mismatch')
      }
      examples.push({
        features,
        label,
        legalLabels,
        handId: JSON.stringify([options.seed, handIndex]),
        actorId,
      })
      history.observe(actorId, observation.amountToCall > 0, label)
      options.onDecision?.(decision)
    },
  })
  return examples
}

function historyFeatures(history: ActorHistory): readonly number[] {
  const facingCount = history.facing.fold + history.facing.call + history.facing.raise
  const freeCount = history.free.fold + history.free.check + history.free.raise
  return [
    boundedCount(facingCount),
    smoothedRate(history.facing.fold, facingCount, 3),
    smoothedRate(history.facing.call, facingCount, 3),
    smoothedRate(history.facing.raise, facingCount, 3),
    boundedCount(freeCount),
    smoothedRate(history.free.fold, freeCount, 3),
    smoothedRate(history.free.check, freeCount, 3),
    smoothedRate(history.free.raise, freeCount, 3),
  ]
}

function updateHistory(history: ActorHistory, facingBet: boolean, label: LearningLabel): void {
  if (facingBet) {
    if (label === 'fold' || label === 'call' || label === 'raise') history.facing[label] += 1
  } else if (label === 'fold' || label === 'check' || label === 'raise') {
    history.free[label] += 1
  }
}

function boundedCount(count: number): number {
  return count / (count + ACTOR_HISTORY_COUNT_SCALE_V2)
}

function smoothedRate(count: number, total: number, choices: number): number {
  return (count + 1) / (total + choices)
}
