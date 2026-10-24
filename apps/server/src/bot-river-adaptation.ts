import {
  type Player,
  prepare,
  type RiverGadget,
  type RiverNode,
  type RiverSolution,
  riverBestResponseValues,
} from './bot-river-solver.js'

/** Absolute chips per protected holding; independent of model and solver error. */
export const RIVER_ADAPTATION_ALLOWANCE = 1e-6
/** Conservative binary search resolution in mixture weight. */
export const RIVER_MIXTURE_STEPS = 18

/**
 * Mix ONLY our realization plans (products of our own action probabilities).
 * At each later decision condition the mixed child sequences on the mixed
 * parent sequence. Opponent actions never enter our realization denominator.
 * Zero-reach rows retain the baseline, as they cannot affect any root value.
 */
export function realizationMixture(
  baseline: RiverSolution,
  proposal: RiverSolution,
  ours: Player,
  weight: number,
): RiverSolution {
  if (weight === 0) return baseline
  return realizationMixtureLine(baseline, proposal, ours)(weight)
}

/** Prepare the two fixed realization plans once for repeated mixture queries. */
export function realizationMixtureLine(
  baseline: RiverSolution,
  proposal: RiverSolution,
  ours: Player,
) {
  const count = prepare(baseline.spot.ranges[ours], baseline.spot.board).combos.length
  const plans: {
    history: string
    width: number
    base: Float64Array
    baseReach: Float64Array
    proposedReach: Float64Array
    nextBase: Float64Array
    nextProposed: Float64Array
  }[] = []
  const walk = (node: RiverNode, baseReach: Float64Array, proposedReach: Float64Array) => {
    if (node.kind !== 'action') return
    if (node.player !== ours) {
      node.children.forEach((child) => {
        walk(child, baseReach, proposedReach)
      })
      return
    }
    const base = baseline.strategy.get(node.history)
    const proposed = proposal.strategy.get(node.history)
    const width = node.actions.length
    if (base?.length !== count * width || proposed?.length !== count * width)
      throw new Error('river mixture requires aligned own strategy tables')
    const nextBase = new Float64Array(base.length)
    const nextProposed = new Float64Array(base.length)
    node.children.forEach((child, a) => {
      const b = new Float64Array(count)
      const p = new Float64Array(count)
      for (let h = 0; h < count; h++) {
        const at = h * width + a
        b[h] = (baseReach[h] as number) * (base[at] as number)
        p[h] = (proposedReach[h] as number) * (proposed[at] as number)
        nextBase[at] = b[h] as number
        nextProposed[at] = p[h] as number
      }
      walk(child, b, p)
    })
    plans.push({
      history: node.history,
      width,
      base,
      baseReach,
      proposedReach,
      nextBase,
      nextProposed,
    })
  }
  walk(baseline.tree, new Float64Array(count).fill(1), new Float64Array(count).fill(1))
  return (weight: number): RiverSolution => {
    if (weight === 0) return baseline
    const strategy = new Map(baseline.strategy)
    for (const plan of plans) {
      const mixed = new Float64Array(plan.base.length)
      for (let h = 0; h < count; h++) {
        const parent =
          (1 - weight) * (plan.baseReach[h] as number) + weight * (plan.proposedReach[h] as number)
        for (let a = 0; a < plan.width; a++) {
          const at = h * plan.width + a
          mixed[at] =
            parent > 0
              ? ((1 - weight) * (plan.nextBase[at] as number) +
                  weight * (plan.nextProposed[at] as number)) /
                parent
              : (plan.base[at] as number)
        }
      }
      strategy.set(plan.history, mixed)
    }
    return { ...baseline, strategy }
  }
}

export function riverCapStatus(solution: RiverSolution, gadget: RiverGadget) {
  const { values, masses } = riverBestResponseValues(solution, gadget.player)
  if (gadget.promises.length !== values.length) throw new Error('unaligned river promises')
  let maxViolation = 0
  let maxSlack = 0
  let violations = 0
  values.forEach((value, h) => {
    const promise = gadget.promises[h] as number
    if (!Number.isFinite(value) || !Number.isFinite(promise) || (masses[h] as number) <= 0) {
      maxViolation = Number.POSITIVE_INFINITY
      violations++
      return
    }
    maxViolation = Math.max(maxViolation, value - promise)
    maxSlack = Math.max(maxSlack, promise - value)
    if (value > promise + RIVER_ADAPTATION_ALLOWANCE) violations++
  })
  return { maxViolation, maxSlack, violations }
}

/** Preserve inherited slack; raise only caps already violated by this fixed baseline.
 * riverCapStatus adds the single absolute allowance when testing these caps.
 */
export function baselineRelativeRiverCaps(
  baseline: RiverSolution,
  gadget: RiverGadget,
): RiverGadget {
  const { values } = riverBestResponseValues(baseline, gadget.player)
  if (gadget.promises.length !== values.length) throw new Error('unaligned river promises')
  return {
    player: gadget.player,
    promises: Float64Array.from(gadget.promises, (promise, h) =>
      Math.max(promise, values[h] as number),
    ),
  }
}

export interface RiverProposal {
  readonly solution: RiverSolution
  /** Fixed posterior/model objective, in chips per deal. */
  readonly value: (solution: RiverSolution) => number
}

/**
 * The feasible set on this realization line is an interval: each holding's
 * BR is a maximum of linear functions. The fixed model objective is linear.
 * Choose its best endpoint, conservatively rounded down. Baseline failure
 * returns the original root, with no proposal query and no promise refresh.
 * Baseline-relative mode explicitly relaxes infeasible inherited caps, retaining
 * the original baseline diagnostics; it does not establish inherited safety.
 */
export function boundedRiverAdaptation(
  baseline: RiverSolution,
  gadget: RiverGadget,
  propose: () => RiverProposal | null,
  baselineRelative = false,
) {
  const base = riverCapStatus(baseline, gadget)
  const caps = baselineRelative ? baselineRelativeRiverCaps(baseline, gadget) : gadget
  const initialCap = baselineRelative ? riverCapStatus(baseline, caps) : base
  const unchanged = {
    solution: baseline,
    weight: 0,
    baseline: base,
    cap: initialCap,
    proposed: false,
  }
  if (initialCap.violations > 0) return unchanged
  const proposal = propose()
  if (proposal === null) return unchanged
  const result = { ...unchanged, proposed: true }
  const gain = proposal.value(proposal.solution) - proposal.value(baseline)
  if (!Number.isFinite(gain) || gain <= 0) return result
  const ours = gadget.player === 0 ? 1 : 0
  let low = 0
  let high = 1
  let solution = baseline
  let cap = initialCap
  const candidate = realizationMixture(baseline, proposal.solution, ours, 1)
  const end = riverCapStatus(candidate, caps)
  if (end.violations === 0) return { ...result, solution: candidate, cap: end, weight: 1 }
  for (let step = 0; step < RIVER_MIXTURE_STEPS; step++) {
    const mid = (low + high) / 2
    const mixed = realizationMixture(baseline, proposal.solution, ours, mid)
    const status = riverCapStatus(mixed, caps)
    if (status.violations === 0) {
      low = mid
      solution = mixed
      cap = status
    } else high = mid
  }
  return { ...result, solution, cap, weight: low }
}
