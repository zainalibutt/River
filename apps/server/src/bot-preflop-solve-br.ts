import type { DealModel, PreflopStrategy } from './bot-preflop-solve-cfr.js'
import {
  compatible,
  type EquityTable,
  HAND_CLASSES,
  type Hole,
} from './bot-preflop-solve-equity.js'
import {
  flopContext,
  isHandRealisation,
  realisationFactor,
  validateRealisation,
} from './bot-preflop-solve-realisation.js'
import {
  type PreflopNode,
  type Realisation,
  type Seat,
  treeDepth,
} from './bot-preflop-solve-tree.js'
export interface Certificate {
  readonly profileValueBb: readonly [number, number]
  readonly bestResponseValueBb: readonly [number, number]
  readonly deviationGainBb: readonly [number, number]
  readonly nashConvBb: number
  /** Mean unilateral improvement, NOT (BR0 + BR1)/2 in a general-sum game. */
  readonly exploitabilityBb: number
  readonly percentOfPostedPot: number
}
/** Separate terminal arithmetic from the trainer, so a trainer payoff bug is detectable. */
function payoff(
  node: Exclude<
    PreflopNode,
    {
      kind: 'decision'
    }
  >,
  p: Seat,
  e: number,
  r: Realisation,
  hand: string,
  depth: number,
): number {
  if (node.kind === 'fold') return node.folder === p ? -node.paid[p] : (node.paid[1 - p] as number)
  let realised = 1
  if (node.kind === 'flop') {
    if (isHandRealisation(r)) {
      const { potType, spr } = flopContext(node.paid, depth)
      realised = realisationFactor(hand, e, p === 0 ? 'ip' : 'oop', potType, spr, r)
    } else realised = p === 0 ? r.ip : r.oop
  }
  return (node.paid[0] + node.paid[1]) * e * realised - node.paid[p]
}
export function validateStrategy(
  tree: PreflopNode,
  strategy: PreflopStrategy,
  hands: number,
): void {
  if (tree.kind !== 'decision') return
  const rows = strategy.get(tree.id)
  if (!rows || rows.length !== hands * tree.actions.length)
    throw new Error(`missing/misshaped strategy: ${tree.id}`)
  for (let h = 0; h < hands; h += 1) {
    let sum = 0
    for (let a = 0; a < tree.actions.length; a += 1) {
      const p = rows[h * tree.actions.length + a] as number
      if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('invalid strategy probability')
      sum += p
    }
    if (Math.abs(sum - 1) > 1e-10) throw new Error('strategy row does not sum to one')
  }
  tree.children.forEach((child) => {
    validateStrategy(child, strategy, hands)
  })
}
/**
 * Independent counterfactual dynamic program. Forward propagation includes chance and
 * OPPONENT actions only; reverse induction maximises one action per own information set.
 * No trainer kernels, regrets, averaging code, or cached trainer values are read.
 */
export function bestResponseCertificate(
  tree: PreflopNode,
  model: DealModel,
  strategy: PreflopStrategy,
  factors: Realisation,
): Certificate {
  const n = model.classes.length
  validateStrategy(tree, strategy, n)
  validateRealisation(factors)
  const depth = treeDepth(tree)
  const totalDeals = model.deals.reduce((a, b) => a + b, 0)
  const solve = (player: Seat, responding: boolean): number => {
    const walk = (node: PreflopNode, opponentReach: Float64Array): Float64Array => {
      const out = new Float64Array(n)
      if (node.kind !== 'decision') {
        for (let h = 0; h < n; h += 1) {
          let mass = 0
          let wins = 0
          for (let o = 0; o < n; o += 1) {
            const pair = player === 0 ? h * n + o : o * n + h
            const e =
              player === 0 ? (model.equity[pair] as number) : 1 - (model.equity[pair] as number)
            const weight = (model.deals[pair] as number) * (opponentReach[o] as number)
            if (node.kind === 'flop' && isHandRealisation(factors)) {
              mass += weight
              wins += weight * e
              continue
            }
            out[h] =
              (out[h] as number) +
              ((model.deals[pair] as number) / totalDeals) *
                (opponentReach[o] as number) *
                payoff(node, player, e, factors, model.classes[h] as string, depth)
          }
          if (node.kind === 'flop' && isHandRealisation(factors))
            out[h] =
              mass === 0
                ? 0
                : (mass / totalDeals) *
                  payoff(node, player, wins / mass, factors, model.classes[h] as string, depth)
        }
        return out
      }
      const width = node.actions.length
      const policy = strategy.get(node.id) as Float64Array
      const values = node.children.map((child, a) => {
        if (node.player === player) return walk(child, opponentReach)
        return walk(
          child,
          Float64Array.from(opponentReach, (reach, o) => reach * (policy[o * width + a] as number)),
        )
      })
      for (let h = 0; h < n; h += 1) {
        if (node.player === player && responding) {
          let best = Number.NEGATIVE_INFINITY
          for (const value of values) best = Math.max(best, value[h] as number)
          out[h] = best
        } else {
          for (let a = 0; a < width; a += 1)
            out[h] =
              (out[h] as number) +
              ((values[a] as Float64Array<ArrayBufferLike>)[h] as number) *
                (node.player === player ? (policy[h * width + a] as number) : 1)
        }
      }
      return out
    }
    return walk(tree, new Float64Array(n).fill(1)).reduce((a, b) => a + b, 0)
  }
  const profileValueBb = [solve(0, false), solve(1, false)] as const
  const bestResponseValueBb = [solve(0, true), solve(1, true)] as const
  const deviationGainBb = [
    bestResponseValueBb[0] - profileValueBb[0],
    bestResponseValueBb[1] - profileValueBb[1],
  ] as const
  if (deviationGainBb.some((gain) => gain < -1e-9))
    throw new Error('best response loses to the profile')
  const nashConvBb = deviationGainBb[0] + deviationGainBb[1]
  return {
    profileValueBb,
    bestResponseValueBb,
    deviationGainBb,
    nashConvBb,
    exploitabilityBb: nashConvBb / 2,
    percentOfPostedPot: (100 * nashConvBb) / 3,
  }
}
/**
 * Physical-combo BR with EXACT removal against class-symmetric opponent policies.
 * For a given hero combo, opponents in a class all take the same action. Thus the
 * class's orbit-averaged equity is sufficient; no pair-specific equity is assumed.
 * This independently enumerates 1,624,350 deals and permits 1,326 distinct own policies.
 */
export function comboBestResponseValues(
  tree: PreflopNode,
  table: EquityTable,
  strategy: PreflopStrategy,
  factors: Realisation,
): readonly [number, number] {
  const combos = HAND_CLASSES.flatMap((h, classId) => h.combos.map((hole) => ({ hole, classId })))
  validateRealisation(factors)
  const depth = treeDepth(tree)
  const n = combos.length
  const m = HAND_CLASSES.length
  const counts = new Float64Array(n * m)
  for (let h = 0; h < n; h += 1) {
    for (const other of combos)
      if (compatible((combos[h] as { hole: Hole; classId: number }).hole, other.hole))
        counts[h * m + other.classId] = (counts[h * m + other.classId] as number) + 1
  }
  const seatValue = (player: Seat): number => {
    const walk = (node: PreflopNode, opponentReach: Float64Array): Float64Array => {
      const out = new Float64Array(n)
      if (node.kind !== 'decision') {
        for (let h = 0; h < n; h += 1) {
          const heroClass = (combos[h] as { hole: Hole; classId: number }).classId
          let mass = 0
          let wins = 0
          for (let o = 0; o < m; o += 1) {
            const e =
              player === 0
                ? (table.equity[heroClass * m + o] as number)
                : 1 - (table.equity[o * m + heroClass] as number)
            const weight = (counts[h * m + o] as number) * (opponentReach[o] as number)
            if (node.kind === 'flop' && isHandRealisation(factors)) {
              mass += weight
              wins += weight * e
              continue
            }
            out[h] =
              (out[h] as number) +
              ((counts[h * m + o] as number) / (1326 * 1225)) *
                (opponentReach[o] as number) *
                payoff(node, player, e, factors, table.classes[heroClass] as string, depth)
          }
          if (node.kind === 'flop' && isHandRealisation(factors))
            out[h] =
              mass === 0
                ? 0
                : (mass / (1326 * 1225)) *
                  payoff(
                    node,
                    player,
                    wins / mass,
                    factors,
                    table.classes[heroClass] as string,
                    depth,
                  )
        }
        return out
      }
      const policy = strategy.get(node.id) as Float64Array
      const width = node.actions.length
      const values = node.children.map((child, a) =>
        node.player === player
          ? walk(child, opponentReach)
          : walk(
              child,
              Float64Array.from(
                opponentReach,
                (reach, o) => reach * (policy[o * width + a] as number),
              ),
            ),
      )
      for (let h = 0; h < n; h += 1) {
        if (node.player === player) out[h] = Math.max(...values.map((v) => v[h] as number))
        else for (const value of values) out[h] = (out[h] as number) + (value[h] as number)
      }
      return out
    }
    return walk(tree, new Float64Array(m).fill(1)).reduce((a, b) => a + b, 0)
  }
  return [seatValue(0), seatValue(1)]
}
