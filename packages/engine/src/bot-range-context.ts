import {
  estimateShowdownEquity,
  type PreflopEquityResult,
  type PreflopRange,
} from './bot-equity.js'
import type { Card } from './cards.js'
import type { HandAction } from './hand-history.js'
import { isAggressiveHandAction } from './hand-history.js'
import type { OpponentModelSummaryV1 } from './opponent-model.js'

export const BOT_RANGE_CONTEXT_TUNING = {
  minimumReadConfidence: 0.5,
  frequentRaiseRate: 0.35,
  rareRaiseRate: 0.15,
  tightEntryRate: 0.2,
} as const

export type PreflopPressure = 'unobserved' | 'passive' | 'raised' | 'reraised'

export interface OpponentRangeContext {
  readonly pressure: PreflopPressure
  readonly centralScenario: PreflopRange
  readonly alternatives: readonly PreflopRange[]
  readonly usedPriorRead: boolean
}

export interface RangeSensitivityOptions {
  readonly hole: readonly [Card, Card]
  readonly board: readonly Card[]
  readonly opponentSeat: number
  readonly actions: readonly HandAction[]
  readonly priorRead?: OpponentModelSummaryV1
  readonly seed: string
  readonly trials: number
}

export interface RangeSensitivityResult {
  readonly context: OpponentRangeContext
  readonly scenarios: Readonly<Record<PreflopRange, PreflopEquityResult>>
  readonly minimumPotShare: number
  readonly maximumPotShare: number
  readonly centralPotShare: number
}

export function opponentRangeContext(
  seat: number,
  actions: readonly HandAction[],
  priorRead?: OpponentModelSummaryV1,
): OpponentRangeContext {
  let highestBet = 0
  let previousRaises = 0
  let entered = false
  let raised = false
  let reraised = false
  for (const entry of actions) {
    if (entry.street !== 'preflop') continue
    const aggressive = isAggressiveHandAction(entry, highestBet)
    if (entry.seat === seat) {
      if (
        entry.action.kind === 'call' ||
        entry.action.kind === 'raiseTo' ||
        entry.action.kind === 'allIn'
      ) {
        entered = true
      }
      if (aggressive) {
        raised = true
        if (previousRaises > 0) reraised = true
      }
    }
    if (aggressive) previousRaises += 1
    if (entry.streetBetAfter !== undefined) highestBet = Math.max(highestBet, entry.streetBetAfter)
  }
  const pressure: PreflopPressure = reraised
    ? 'reraised'
    : raised
      ? 'raised'
      : entered
        ? 'passive'
        : 'unobserved'
  let centralScenario: PreflopRange =
    pressure === 'reraised'
      ? 'premium'
      : pressure === 'raised'
        ? 'tight'
        : pressure === 'passive'
          ? 'loose'
          : 'random'
  const usedPriorRead =
    priorRead !== undefined &&
    priorRead.confidence >= BOT_RANGE_CONTEXT_TUNING.minimumReadConfidence
  if (usedPriorRead && priorRead !== undefined) {
    if (pressure === 'passive' && priorRead.vpip <= BOT_RANGE_CONTEXT_TUNING.tightEntryRate) {
      centralScenario = 'tight'
    }
    if (pressure === 'raised' || pressure === 'reraised') {
      if (priorRead.pfr >= BOT_RANGE_CONTEXT_TUNING.frequentRaiseRate) {
        centralScenario = pressure === 'reraised' ? 'tight' : 'loose'
      } else if (priorRead.pfr <= BOT_RANGE_CONTEXT_TUNING.rareRaiseRate) {
        centralScenario = 'premium'
      }
    }
  }
  return {
    pressure,
    centralScenario,
    alternatives: ['random', 'loose', 'tight', 'premium'],
    usedPriorRead,
  }
}

export function estimateRangeSensitivity(options: RangeSensitivityOptions): RangeSensitivityResult {
  const context = opponentRangeContext(options.opponentSeat, options.actions, options.priorRead)
  const scenarios = {} as Record<PreflopRange, PreflopEquityResult>
  for (const range of context.alternatives) {
    scenarios[range] = estimateShowdownEquity({
      hole: options.hole,
      board: options.board,
      opponents: 1,
      ranges: [range],
      seed: options.seed,
      trials: options.trials,
    })
  }
  const shares = context.alternatives.map((range) => scenarios[range].potShare)
  return {
    context,
    scenarios,
    minimumPotShare: Math.min(...shares),
    maximumPotShare: Math.max(...shares),
    centralPotShare: scenarios[context.centralScenario].potShare,
  }
}
