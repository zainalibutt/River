/**
 * REP is reputation earned per hand. It is separate from bankroll and from any
 * ranked rating, and it is never spendable - nothing here moves through the
 * ledger.
 *
 * The number a player sees as `120%` is an EARNING-RATE MODIFIER, not level
 * progress. Level progress lives in rep-progression.ts and means something
 * different; the two must not be conflated in the UI.
 */
export interface RepBreakdown {
  baseRep: number
  buyInScale: number
  tableItemBonus: number
  eventBonus: number
  challengeBonus: number
  otherBonus: number
  totalRep: number
}

export interface RepConfig {
  baseRepPerHand: number
  winMultiplier: number
  showdownMultiplier: number
  /** Stake at which buyInScale is exactly 1.0. */
  buyInReference: number
  buyInScaleMin: number
  buyInScaleMax: number
}

export interface RepInput {
  wonHand: boolean
  reachedShowdown: boolean
  buyIn: number
  /** Each entry is an additive rate: 0.05 means +5%. */
  tableItemModifiers: readonly number[]
  eventModifiers: readonly number[]
  challengeModifiers: readonly number[]
  otherModifiers: readonly number[]
}

export const DEFAULT_REP_CONFIG: RepConfig = {
  baseRepPerHand: 40,
  winMultiplier: 1.6,
  showdownMultiplier: 1.25,
  buyInReference: 100_000,
  buyInScaleMin: 0.5,
  buyInScaleMax: 2.5,
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function sum(rates: readonly number[]): number {
  return rates.reduce((total, rate) => total + rate, 0)
}

/**
 * Higher stakes earn more REP, but bounded. An unbounded scale would make the
 * highest table the only table worth sitting at.
 */
export function buyInScaleFor(buyIn: number, config: RepConfig): number {
  if (config.buyInReference <= 0) return config.buyInScaleMin
  return clamp(buyIn / config.buyInReference, config.buyInScaleMin, config.buyInScaleMax)
}

/**
 * Modifiers are ADDITIVE RATES against the base, never compounding with each
 * other. Three +10% items give +30%, not +33.1%. The spec rejected compounding
 * in the economy for the same reason: it turns a modest edge into a runaway one.
 */
export function computeRep(input: RepInput, config: RepConfig = DEFAULT_REP_CONFIG): RepBreakdown {
  const buyInScale = buyInScaleFor(input.buyIn, config)
  const outcome =
    (input.wonHand ? config.winMultiplier : 1) *
    (input.reachedShowdown ? config.showdownMultiplier : 1)

  const baseRep = Math.max(0, config.baseRepPerHand * buyInScale * outcome)

  const bonusFor = (rates: readonly number[]): number => baseRep * sum(rates)
  const tableItemBonus = bonusFor(input.tableItemModifiers)
  const eventBonus = bonusFor(input.eventModifiers)
  const challengeBonus = bonusFor(input.challengeModifiers)
  const otherBonus = bonusFor(input.otherModifiers)

  const rawTotal = baseRep + tableItemBonus + eventBonus + challengeBonus + otherBonus
  const totalRep = Math.max(0, Math.round(rawTotal))

  // The reported fields must reconcile with the total a player is credited, so
  // the rounding difference is absorbed into baseRep rather than left dangling.
  const bonusTotal = tableItemBonus + eventBonus + challengeBonus + otherBonus

  return {
    baseRep: totalRep - bonusTotal,
    buyInScale,
    tableItemBonus,
    eventBonus,
    challengeBonus,
    otherBonus,
    totalRep,
  }
}

/**
 * The displayed earning rate. 120 means "earning at 120% of base".
 * Derived from the breakdown, never stored.
 */
export function earningRatePercent(breakdown: RepBreakdown): number {
  const bonus =
    breakdown.tableItemBonus +
    breakdown.eventBonus +
    breakdown.challengeBonus +
    breakdown.otherBonus
  const base = breakdown.totalRep - bonus
  if (base <= 0) return 100
  return Math.round(((base + bonus) / base) * 100)
}
