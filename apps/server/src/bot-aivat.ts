import {
  type BotDecision,
  type BotObservationV1,
  type Card,
  cardKey,
  handScore,
  makeDeck,
  mulberry32,
  seedFromString,
  type TurnAction,
} from '@river/engine'
import type { RangeCombo } from './bot-river-solver.js'

/** Frozen before evaluation. No fitted parameters or evaluation outcomes. */
export const AIVAT_HEURISTIC = 'pot-share-uniform-32-v1'
export const AIVAT_V2_HEURISTIC = 'tracked-range-value-networks-v2'
export type AivatHeuristicId = typeof AIVAT_HEURISTIC | typeof AIVAT_V2_HEURISTIC

/** Pre-action reaches, out of position first. Never inferred from future cards. */
export interface AivatRangeState {
  readonly actorPlayer: 0 | 1
  readonly ranges: readonly [readonly RangeCombo[], readonly RangeCombo[]]
}

export interface AivatValueHeuristic {
  readonly id: AivatHeuristicId
  readonly specificationSha256: string
  readonly value: (
    observation: BotObservationV1,
    action: TurnAction,
    state: AivatRangeState | undefined,
  ) => number
}

export interface AivatChoice {
  readonly action: string
  readonly probability: number
  readonly value: number
}

export interface AivatControl {
  readonly kind: 'action' | 'chance'
  readonly choices: readonly AivatChoice[]
  readonly taken: string
}

export interface AivatDecision {
  readonly heuristic: AivatHeuristicId
  readonly specificationSha256?: string
  readonly rangeState?: AivatRangeState
  readonly observation: BotObservationV1
  readonly control: AivatControl | null
  readonly reason: string | null
}

/** Singleton information partitions: imaginary-observation averaging is identity.
 * Unknown-player nodes contribute no correction. Values may be inaccurate, but
 * must be fixed independently of the sampled action and all subsequent events.
 */
export function aivatCorrection(control: AivatControl): number {
  let mass = 0
  let expected = 0
  let observed: number | undefined
  const actions = new Set<string>()
  for (const choice of control.choices) {
    if (
      actions.has(choice.action) ||
      !Number.isFinite(choice.probability) ||
      choice.probability < 0 ||
      !Number.isFinite(choice.value)
    )
      throw new Error('invalid AIVAT choice')
    actions.add(choice.action)
    mass += choice.probability
    expected += choice.probability * choice.value
    if (choice.action === control.taken && choice.probability > 0) observed = choice.value
  }
  if (Math.abs(mass - 1) > 1e-9 || observed === undefined) {
    throw new Error('AIVAT needs normalized exact probabilities and a supported action')
  }
  return expected - observed
}

export function aivatChips(raw: number, controls: readonly AivatControl[]): number {
  if (!Number.isFinite(raw)) throw new Error('invalid AIVAT payoff')
  return raw + controls.reduce((sum, control) => sum + aivatCorrection(control), 0)
}

export interface StrategyChoice {
  readonly decision: BotDecision
  readonly probability: number
}
const captures = new WeakMap<
  () => number,
  {
    includeState: boolean
    sink: (choices: readonly StrategyChoice[], state?: AivatRangeState) => void
  }
>()

/** Scope uses the actual policy RNG identity; hypothetical range queries cannot
 * overwrite this decision's record. Never invokes the policy an extra time. */
export function withStrategyCapture<T>(rng: () => number, run: () => T, includeState = false) {
  let choices: readonly StrategyChoice[] | undefined
  let state: AivatRangeState | undefined
  const previous = captures.get(rng)
  captures.set(rng, {
    includeState,
    sink: (row, ranges) => {
      choices = row
      state = ranges
    },
  })
  try {
    const result = run()
    return { result, choices, state }
  } finally {
    if (previous) captures.set(rng, previous)
    else captures.delete(rng)
  }
}

/** Record the distribution induced by the existing cumulative sampler,
 * including its last-bucket rounding remainder. Does not draw randomness. */
export function captureCumulativeStrategy(
  rng: () => number,
  weights: ArrayLike<number>,
  decision: (index: number) => BotDecision,
  total = 1,
  state?: () => AivatRangeState,
): void {
  const sink = captures.get(rng)
  if (!sink) return
  if (!(total > 0) || weights.length === 0) throw new Error('invalid strategy mass')
  let cumulative = 0
  let previous = 0
  const choices: StrategyChoice[] = []
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index] as number
    if (!Number.isFinite(weight) || weight < 0) throw new Error('invalid strategy weight')
    cumulative += weight / total
    const boundary = index === weights.length - 1 ? 1 : Math.min(1, cumulative)
    choices.push({ decision: decision(index), probability: boundary - previous })
    previous = boundary
  }
  sink.sink(choices, sink.includeState ? state?.() : undefined)
}

export function actionKey(action: TurnAction): string {
  return action.kind === 'raiseTo' ? `raiseTo:${action.to}` : action.kind
}

/** A cheap, deterministic pot-share heuristic. The same 32 uniform opponent /
 * runout draws are used for every alternative at this node. Fixed MC error
 * affects variance only: the exact strategy sum centers the action control. */
export function frozenPotShare(hole: readonly Card[], board: readonly Card[]): number {
  const known = new Set([...hole, ...board].map(cardKey))
  const deck = makeDeck().filter((card) => !known.has(cardKey(card)))
  const rng = mulberry32(
    seedFromString(`${AIVAT_HEURISTIC}:${[...hole, ...board].map(cardKey).join(',')}`),
  )
  let wins = 0
  for (let sample = 0; sample < 32; sample++) {
    const pool = [...deck]
    const draw = () => pool.splice(Math.floor(rng() * pool.length), 1)[0] as Card
    const other = [draw(), draw()]
    const completed = [...board]
    while (completed.length < 5) completed.push(draw())
    const ours = handScore([...hole, ...completed])
    const theirs = handScore([...other, ...completed])
    wins += ours > theirs ? 1 : ours === theirs ? 0.5 : 0
  }
  return wins / 32
}

/** Merge abstract choices after the same legalisation used for actual play. */
export function actionControl(
  observation: BotObservationV1,
  choices: readonly StrategyChoice[],
  taken: TurnAction,
  legalise: (decision: BotDecision) => TurnAction | null,
  valueForAction?: (action: TurnAction) => number,
): AivatControl {
  const share = valueForAction ? 0 : frozenPotShare(observation.actor.hole, observation.board)
  const actor = observation.seats.find((seat) => seat.seat === observation.actor.seat)
  if (!actor) throw new Error('AIVAT actor missing')
  const keyFor = (action: TurnAction) => {
    if (action.kind === 'allIn' && actor.stack <= observation.amountToCall) return 'call'
    if (action.kind === 'raiseTo' && action.to === actor.stack + actor.betStreet) return 'allIn'
    return actionKey(action)
  }
  const pot = observation.seats.reduce((sum, seat) => sum + seat.betHand, 0)
  const merged = new Map<string, AivatChoice>()
  for (const choice of choices) {
    const action = legalise(choice.decision)
    if (!action) throw new Error('AIVAT alternative could not be legalised')
    const key = keyFor(action)
    const cost =
      action.kind === 'call'
        ? Math.min(actor.stack, observation.amountToCall)
        : action.kind === 'allIn'
          ? actor.stack
          : action.kind === 'raiseTo'
            ? action.to - actor.betStreet
            : 0
    const value = valueForAction
      ? valueForAction(action)
      : action.kind === 'fold'
        ? -actor.betHand
        : share * (pot + cost) - actor.betHand - cost
    merged.set(key, {
      action: key,
      value,
      probability: choice.probability + (merged.get(key)?.probability ?? 0),
    })
  }
  const control: AivatControl = {
    kind: 'action',
    choices: [...merged.values()],
    taken: keyFor(taken),
  }
  aivatCorrection(control)
  return control
}
