import { personalityPool } from '@river/engine'
import { runBotBenchmark } from './bot-benchmark.js'
import type { ActionModelV1 } from './bot-learning-model.js'
import type { OnlineForecastTuning } from './bot-learning-online-v3.js'
import { OnlineActionShadow } from './bot-learning-shadow.js'

export interface SyntheticShadowCanaryOptions {
  readonly seed: string
  readonly hands: number
}

export async function runSyntheticShadowCanaryV3(
  frozen: ActionModelV1,
  candidate: ActionModelV1,
  tuning: OnlineForecastTuning,
  options: SyntheticShadowCanaryOptions,
) {
  if (!Number.isSafeInteger(options.hands) || options.hands < 1 || options.hands > 500) {
    throw new Error('synthetic shadow canary needs 1 to 500 hands')
  }
  const seats = personalityPool()
    .slice(0, 9)
    .map((personality) => ({ personality }))
  if (seats.length !== 9) throw new Error('synthetic shadow canary needs nine seats')
  const shadow = new OnlineActionShadow(frozen, candidate, tuning)
  let accepted = 0
  let maxPending = 0
  const started = performance.now()
  for (let hand = 0; hand < options.hands; hand += 1) {
    runBotBenchmark({
      seed: `${options.seed}:${hand}`,
      hands: 1,
      seats,
      onDecision({ observation, action }) {
        const prepared = shadow.prepareObservation({ ...observation, roomId: options.seed })
        shadow.accepted(prepared, action)
        accepted += 1
        maxPending = Math.max(maxPending, shadow.stats().pending)
      },
    })
    await shadow.flush()
  }
  const stats = shadow.stats()
  if (stats.forecasts !== accepted || stats.dropped > 0 || stats.failed > 0 || stats.pending > 0) {
    throw new Error('synthetic shadow canary lost or failed an accepted forecast')
  }
  return {
    kind: 'synthetic-nine-seat-shadow-canary' as const,
    seats: 9 as const,
    hands: options.hands,
    accepted,
    maxPending,
    elapsedMs: performance.now() - started,
    stats,
  }
}
