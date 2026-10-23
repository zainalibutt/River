import {
  type PreflopNode,
  type Realisation,
  type Seat,
  terminalUtility,
  validateRealisation,
} from './bot-preflop-solve-tree.js'
/** Full ordered deal distribution. It can also describe a small exhaustive test game. */
export interface DealModel {
  readonly classes: readonly string[]
  readonly multiplicities: readonly number[]
  readonly deals: readonly number[]
  readonly equity: readonly number[]
}
export type PreflopStrategy = ReadonlyMap<string, Float64Array>
interface LearningNode {
  readonly regrets: Float64Array
  readonly sum: Float64Array
}
export function validateModel(model: DealModel): void {
  const n = model.classes.length
  if (
    n === 0 ||
    model.multiplicities.length !== n ||
    model.deals.length !== n * n ||
    model.equity.length !== n * n
  )
    throw new Error('invalid deal model dimensions')
  for (let a = 0; a < n; a += 1) {
    if (!((model.multiplicities[a] as number) > 0)) throw new Error('invalid hand multiplicity')
    let rowMass = 0
    for (let b = 0; b < n; b += 1) {
      const i = a * n + b
      if (
        !Number.isFinite(model.deals[i]) ||
        (model.deals[i] as number) < 0 ||
        model.deals[i] !== model.deals[b * n + a]
      )
        throw new Error('invalid symmetric deal measure')
      if (
        !Number.isFinite(model.equity[i]) ||
        (model.equity[i] as number) < 0 ||
        (model.equity[i] as number) > 1
      )
        throw new Error('invalid equity')
      rowMass += model.deals[i] as number
    }
    if (rowMass === 0) throw new Error('unreachable hand class')
  }
}
function matched(regrets: Float64Array, hands: number, width: number): Float64Array {
  const strategy = new Float64Array(regrets.length)
  for (let h = 0; h < hands; h += 1) {
    let sum = 0
    for (let a = 0; a < width; a += 1) sum += Math.max(0, regrets[h * width + a] as number)
    for (let a = 0; a < width; a += 1) {
      const i = h * width + a
      strategy[i] = sum > 0 ? Math.max(0, regrets[i] as number) / sum : 1 / width
    }
  }
  return strategy
}
/**
 * Range-vector alternating CFR+/DCFR. Every legal deal is integrated, never sampled.
 * Each return is conditional on our holding, weighted by opponent counterfactual reach.
 * Two separate utility kernels are essential: fixed realisation factors are general-sum.
 */
export class PreflopTrainer {
  private readonly nodes = new Map<string, LearningNode>()
  private readonly kernels = new Map<PreflopNode, readonly [Float64Array, Float64Array]>()
  readonly hands: number
  iterations = 0
  constructor(
    readonly tree: PreflopNode,
    readonly model: DealModel,
    readonly factors: Realisation,
    readonly scheme: 'dcfr' | 'cfr+' = 'dcfr',
  ) {
    validateModel(model)
    validateRealisation(factors)
    this.hands = model.classes.length
    const n = this.hands
    const rowMass = Array.from({ length: n }, (_, h) =>
      model.deals.slice(h * n, (h + 1) * n).reduce((a, b) => a + b, 0),
    )
    const prepare = (node: PreflopNode): void => {
      if (node.kind === 'decision') {
        this.nodes.set(node.id, {
          regrets: new Float64Array(n * node.actions.length),
          sum: new Float64Array(n * node.actions.length),
        })
        node.children.forEach(prepare)
      } else {
        const kernels: [Float64Array, Float64Array] = [
          new Float64Array(n * n),
          new Float64Array(n * n),
        ]
        for (const player of [0, 1] as const) {
          for (let h = 0; h < n; h += 1) {
            for (let o = 0; o < n; o += 1) {
              const e =
                player === 0
                  ? (model.equity[h * n + o] as number)
                  : 1 - (model.equity[o * n + h] as number)
              kernels[player][h * n + o] =
                ((model.deals[h * n + o] as number) / (rowMass[h] as number)) *
                terminalUtility(node, player, e, factors)
            }
          }
        }
        this.kernels.set(node, kernels)
      }
    }
    prepare(tree)
  }
  step(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 1)
      throw new Error('positive iteration count required')
    const n = this.hands
    for (let iteration = 0; iteration < count; iteration += 1) {
      this.iterations += 1
      const t = this.iterations
      const positiveDiscount = t ** 1.5 / (t ** 1.5 + 1)
      const averageWeight = this.scheme === 'dcfr' ? t * t : t
      const walk = (
        node: PreflopNode,
        player: Seat,
        own: Float64Array,
        opponent: Float64Array,
      ): Float64Array => {
        const value = new Float64Array(n)
        if (node.kind !== 'decision') {
          const kernel = (
            this.kernels.get(node) as readonly [
              Float64Array<ArrayBufferLike>,
              Float64Array<ArrayBufferLike>,
            ]
          )[player]
          for (let h = 0; h < n; h += 1) {
            let sum = 0
            const base = h * n
            for (let o = 0; o < n; o += 1)
              sum += (kernel[base + o] as number) * (opponent[o] as number)
            value[h] = sum
          }
          return value
        }
        const learning = this.nodes.get(node.id) as LearningNode
        const width = node.actions.length
        const strategy = matched(learning.regrets, n, width)
        const childValues: Float64Array[] = []
        for (let a = 0; a < width; a += 1) {
          const reach = new Float64Array(n)
          const prior = node.player === player ? own : opponent
          for (let h = 0; h < n; h += 1)
            reach[h] = (prior[h] as number) * (strategy[h * width + a] as number)
          const child = walk(
            node.children[a] as PreflopNode,
            player,
            node.player === player ? reach : own,
            node.player === player ? opponent : reach,
          )
          childValues.push(child)
          for (let h = 0; h < n; h += 1)
            value[h] =
              (value[h] as number) +
              (child[h] as number) *
                (node.player === player ? (strategy[h * width + a] as number) : 1)
        }
        if (node.player === player) {
          for (let h = 0; h < n; h += 1) {
            for (let a = 0; a < width; a += 1) {
              const i = h * width + a
              const previous = learning.regrets[i] as number
              const discounted =
                this.scheme === 'dcfr'
                  ? previous * (previous > 0 ? positiveDiscount : 0.5)
                  : previous
              const updated =
                discounted +
                ((childValues[a] as Float64Array<ArrayBufferLike>)[h] as number) -
                (value[h] as number)
              learning.regrets[i] = this.scheme === 'cfr+' ? Math.max(0, updated) : updated
              learning.sum[i] =
                (learning.sum[i] as number) +
                averageWeight * (own[h] as number) * (strategy[i] as number)
            }
          }
        }
        return value
      }
      walk(this.tree, 0, new Float64Array(n).fill(1), new Float64Array(n).fill(1))
      walk(this.tree, 1, new Float64Array(n).fill(1), new Float64Array(n).fill(1))
    }
  }
  average(): PreflopStrategy {
    const out = new Map<string, Float64Array>()
    for (const [id, node] of this.nodes)
      out.set(id, matched(node.sum, this.hands, node.sum.length / this.hands))
    return out
  }
}
