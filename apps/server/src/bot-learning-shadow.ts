import type { BotObservationV1, HandAction, TurnAction } from '@river/engine'
import {
  extractLearningFeaturesV1,
  type LearningLabel,
  labelFor,
  legalLabelsFor,
} from './bot-learning-data.js'
import { CausalActionHistoryV2, LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { type ActionModelV1, validateModel } from './bot-learning-model.js'
import {
  ONLINE_FORECAST_TUNING_V3,
  OnlineActionForecaster,
  type OnlineForecastTuning,
} from './bot-learning-online-v3.js'
import { observationFor } from './bot-service.js'
import type { RoomView } from './protocol.js'

export interface PreparedActionShadow {
  readonly actorKey: string
  readonly features: readonly number[]
  readonly legalLabels: readonly LearningLabel[]
  readonly facingBet: boolean
  readonly actor: { readonly betStreet: number; readonly stack: number }
  readonly currentBet: number
}

export interface ActionShadowPort {
  prepare(
    roomId: string,
    playerId: string,
    view: RoomView,
    actions: readonly HandAction[] | null,
  ): PreparedActionShadow | null
  accepted(prepared: PreparedActionShadow, action: TurnAction): void
  forgetActor(roomId: string, playerId: string): void
}

export interface ActionShadowStats {
  readonly forecasts: number
  readonly adaptedForecasts: number
  readonly dropped: number
  readonly failed: number
  readonly pending: number
  readonly meanLogLoss: number | null
  readonly captureP95Ms: number | null
  readonly inferenceP95Ms: number | null
}

interface QueuedForecast {
  readonly prepared: PreparedActionShadow
  readonly label: LearningLabel
}

export const ACTION_SHADOW_LIMITS = {
  maxPending: 128,
  timingSamples: 256,
} as const

export class OnlineActionShadow implements ActionShadowPort {
  private readonly forecaster: OnlineActionForecaster
  private readonly history = new CausalActionHistoryV2()
  private readonly queue: QueuedForecast[] = []
  private readonly captureTimes: number[] = []
  private readonly inferenceTimes: number[] = []
  private readonly flushResolvers: Array<() => void> = []
  private scheduled = false
  private processing = false
  private forecasts = 0
  private adaptedForecasts = 0
  private dropped = 0
  private failed = 0
  private logLossTotal = 0

  constructor(
    frozen: ActionModelV1,
    candidate: ActionModelV1,
    tuning: OnlineForecastTuning = ONLINE_FORECAST_TUNING_V3,
    private readonly schedule: (task: () => void) => void = setImmediate,
  ) {
    validateModel(frozen)
    validateModel(candidate)
    this.forecaster = new OnlineActionForecaster(frozen, candidate, tuning)
  }

  prepare(
    roomId: string,
    playerId: string,
    view: RoomView,
    actions: readonly HandAction[] | null,
  ): PreparedActionShadow | null {
    if (actions === null) return null
    const start = performance.now()
    const observation = observationFor(view, playerId, undefined, roomId, actions)
    if (observation === null) return null
    return this.prepareObservationAt(observation, start)
  }

  prepareObservation(observation: BotObservationV1): PreparedActionShadow {
    return this.prepareObservationAt(observation, performance.now())
  }

  private prepareObservationAt(observation: BotObservationV1, start: number): PreparedActionShadow {
    const actorKey = JSON.stringify([observation.roomId, observation.actor.playerId])
    const features = [...extractLearningFeaturesV1(observation), ...this.history.features(actorKey)]
    if (features.length !== LEARNING_FEATURES_V2.length)
      throw new Error('shadow feature schema mismatch')
    const prepared = {
      actorKey,
      features,
      legalLabels: [...legalLabelsFor(observation)],
      facingBet: observation.amountToCall > 0,
      actor: { betStreet: observation.actor.betStreet, stack: observation.actor.stack },
      currentBet: observation.currentBet,
    }
    this.recordTime(this.captureTimes, performance.now() - start)
    return prepared
  }

  accepted(prepared: PreparedActionShadow, action: TurnAction): void {
    const label = labelFor(action, prepared)
    if (!prepared.legalLabels.includes(label))
      throw new Error('shadow accepted action is not legal')
    this.history.observe(prepared.actorKey, prepared.facingBet, label)
    if (this.queue.length >= ACTION_SHADOW_LIMITS.maxPending) {
      this.dropped += 1
      return
    }
    this.queue.push({ prepared, label })
    this.scheduleNext()
  }

  forgetActor(roomId: string, playerId: string): void {
    const actorKey = JSON.stringify([roomId, playerId])
    this.history.forget(actorKey)
    this.forecaster.forgetActor(actorKey)
    const retained = this.queue.filter((item) => item.prepared.actorKey !== actorKey)
    this.dropped += this.queue.length - retained.length
    this.queue.splice(0, this.queue.length, ...retained)
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 && !this.scheduled && !this.processing) return
    await new Promise<void>((resolve) => this.flushResolvers.push(resolve))
  }

  stats(): ActionShadowStats {
    return {
      forecasts: this.forecasts,
      adaptedForecasts: this.adaptedForecasts,
      dropped: this.dropped,
      failed: this.failed,
      pending: this.queue.length + Number(this.processing),
      meanLogLoss: this.forecasts > 0 ? this.logLossTotal / this.forecasts : null,
      captureP95Ms: percentile95(this.captureTimes),
      inferenceP95Ms: percentile95(this.inferenceTimes),
    }
  }

  private scheduleNext(): void {
    if (this.scheduled || this.processing || this.queue.length === 0) return
    this.scheduled = true
    try {
      this.schedule(() => this.processNext())
    } catch {
      this.scheduled = false
      this.failed += 1
      this.dropped += this.queue.length
      this.queue.length = 0
      this.resolveFlushes()
    }
  }

  private processNext(): void {
    this.scheduled = false
    const next = this.queue.shift()
    if (next === undefined) {
      this.resolveFlushes()
      return
    }
    this.processing = true
    const start = performance.now()
    try {
      const forecast = this.forecaster.forecast(
        next.prepared.actorKey,
        next.prepared.features,
        next.prepared.legalLabels,
      )
      this.forecaster.observe(forecast, next.label)
      this.forecasts += 1
      if (forecast.candidateWeight > 0) this.adaptedForecasts += 1
      this.logLossTotal -= Math.log(Math.max(1e-12, forecast.probabilities[next.label]))
    } catch {
      this.failed += 1
    } finally {
      this.recordTime(this.inferenceTimes, performance.now() - start)
      this.processing = false
      this.scheduleNext()
      this.resolveFlushes()
    }
  }

  private recordTime(times: number[], elapsedMs: number): void {
    times.push(elapsedMs)
    if (times.length > ACTION_SHADOW_LIMITS.timingSamples) times.shift()
  }

  private resolveFlushes(): void {
    if (this.queue.length > 0 || this.scheduled || this.processing) return
    for (const resolve of this.flushResolvers.splice(0)) resolve()
  }
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? null
}
