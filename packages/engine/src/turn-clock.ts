import type { Street } from './betting.js'

export interface TurnClockConfig {
  preflopSeconds?: number
  flopSeconds?: number
  turnSeconds?: number
  riverSeconds?: number
  /** Fraction of budget remaining at which the urgency ring appears. */
  urgencyFraction?: number
}

const DEFAULT_BUDGET_SECONDS: Record<Street, number> = {
  preflop: 15,
  flop: 20,
  turn: 20,
  river: 25,
}

const DEFAULT_URGENCY_FRACTION = 0.5

export type TurnPhase = 'idle' | 'running' | 'urgent' | 'expired'

export interface TurnClock {
  phase: TurnPhase
  remainingMs: number
  fraction: number
  handDegrees: number
  urgent: boolean
}

export function turnBudgetMs(street: Street, config?: TurnClockConfig): number {
  const fallback = DEFAULT_BUDGET_SECONDS[street]
  const configured = config?.[`${street}Seconds`]
  const seconds = configured ?? fallback
  if (!Number.isFinite(seconds)) return 0
  return Math.max(0, Math.round(seconds * 1000))
}

export function turnClock(
  deadlineMs: number | null,
  nowMs: number,
  budgetMs: number,
  config?: TurnClockConfig,
): TurnClock {
  const urgency = config?.urgencyFraction ?? DEFAULT_URGENCY_FRACTION

  if (deadlineMs === null) {
    return { phase: 'idle', remainingMs: budgetMs, fraction: 1, handDegrees: 0, urgent: false }
  }
  if (!Number.isFinite(deadlineMs)) {
    return { phase: 'idle', remainingMs: budgetMs, fraction: 1, handDegrees: 0, urgent: false }
  }

  const usableBudget = Number.isFinite(budgetMs) ? Math.max(0, budgetMs) : 0
  const elapsed = deadlineMs - nowMs
  const remaining = elapsed > 0 ? Math.min(elapsed, usableBudget) : 0

  const fraction = usableBudget > 0 ? clamp01(remaining / usableBudget) : 0
  const handDegrees = 360 * (1 - fraction)
  const urgent = fraction < urgency

  let phase: TurnPhase
  if (remaining <= 0) {
    phase = 'expired'
  } else if (urgent) {
    phase = 'urgent'
  } else {
    phase = 'running'
  }
  return {
    phase,
    remainingMs: remaining,
    fraction,
    handDegrees,
    urgent,
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
