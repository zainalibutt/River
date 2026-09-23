import { type BotDecision, type BotPolicy, personalityPool } from '@river/engine'
import type { BenchmarkSeat } from './bot-benchmark.js'
import type { LearningExampleV1 } from './bot-learning-data.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { type ActionModelV1, evaluateActionModel } from './bot-learning-model.js'
import { botPlayerId } from './bot-service.js'

export const BOT_LEARNING_SHIFT_V2 = {
  seed: 'opponent-action-v2-authored-shift',
  hands: 400,
  castIndices: [2, 7, 9, 11],
} as const

type ShiftStyle = 'nit' | 'calling-station' | 'pressure' | 'mixed'
const STYLES: readonly ShiftStyle[] = ['nit', 'calling-station', 'pressure', 'mixed']

function policyFor(style: ShiftStyle): BotPolicy {
  return {
    id: `authored-shift-${style}`,
    version: 1,
    decide(context) {
      const { legal, amountToCall, pot, actor } = context.observation
      const roll = context.rng()
      let decision: BotDecision
      if (style === 'nit') {
        decision = amountToCall > 0 && legal.fold ? { kind: 'fold' } : { kind: 'check' }
      } else if (style === 'calling-station') {
        decision = amountToCall > 0 ? { kind: 'call' } : { kind: 'check' }
      } else if (style === 'pressure') {
        const target = Math.min(
          legal.raiseTo.max,
          Math.max(legal.raiseTo.min, context.observation.currentBet + Math.round(pot * 0.75)),
        )
        decision = legal.raiseTo.enabled
          ? { kind: 'raiseTo', to: target }
          : amountToCall > 0
            ? { kind: 'call' }
            : { kind: 'check' }
      } else {
        decision =
          roll < 0.18 && legal.raiseTo.enabled
            ? { kind: 'raiseTo', to: Math.min(legal.raiseTo.max, actor.betStreet + actor.stack) }
            : amountToCall > 0
              ? roll < 0.58
                ? { kind: 'call' }
                : { kind: 'fold' }
              : { kind: 'check' }
      }
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: context.observation.version,
        decision,
        fallbackReason: null,
      }
    },
  }
}

export function authoredShiftSeats(indices: readonly number[]): readonly BenchmarkSeat[] {
  if (indices.length !== STYLES.length || new Set(indices).size !== STYLES.length) {
    throw new Error('authored shift needs four distinct cast identities')
  }
  const cast = personalityPool()
  return indices.map((index, seat) => {
    const personality = cast[index]
    const style = STYLES[seat]
    if (personality === undefined || style === undefined)
      throw new Error('authored shift cast missing')
    return { personality, policy: policyFor(style) }
  })
}

export function runLearningShiftV2(
  model: ActionModelV1,
  training: readonly LearningExampleV1[],
  options: { seed: string; hands: number; castIndices: readonly number[] } = BOT_LEARNING_SHIFT_V2,
) {
  const seats = authoredShiftSeats(options.castIndices)
  const heldOut = collectLearningExamplesV2({
    seed: options.seed,
    hands: options.hands,
    seats,
  })
  return {
    source: 'authored synthetic nit, calling-station, pressure and mixed policies; no human hands',
    seed: options.seed,
    hands: options.hands,
    count: heldOut.length,
    cast: seats.map((seat) => ({ id: seat.personality.id, policy: seat.policy?.id })),
    evaluation: evaluateActionModel(model, training, heldOut),
    byStyle: seats.map((seat, index) => {
      const style = STYLES[index]
      if (style === undefined) throw new Error('authored shift style missing')
      const examples = heldOut.filter(
        (example) => example.actorId === botPlayerId(seat.personality.id),
      )
      return {
        style,
        count: examples.length,
        evaluation: evaluateActionModel(model, training, examples),
      }
    }),
  }
}
