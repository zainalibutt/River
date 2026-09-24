import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  boardTexture,
  estimateShowdownEquity,
  holdingOf,
  mulberry32,
  type Rng,
  summarisePublicActions,
} from '@river/engine'
import { bucketAction, bucketOf, type Situation, situationOf } from './bot-rollout.js'

/**
 * The legal inputs a learned value model reads, in a fixed order.
 *
 * Every one comes from the acting seat's observation: its own cards and the
 * board, prices and stacks, seat order, the current hand's public actions and
 * the pooled public statistics of the one opponent left. No hidden card, deck
 * order or style label is an input; hidden cards only ever label training
 * outcomes offline.
 */
export const VALUE_FEATURES = [
  'flop',
  'turn',
  'river',
  'air',
  'draw',
  'pair',
  'strong',
  'equityRandom',
  'equityTight',
  'price',
  'betToPot',
  'stackToPot',
  'inPosition',
  'opponentRaisedThisStreet',
  'opponentAggressiveStreets',
  'opponentFoldToBet',
  'opponentFoldToBetWeight',
  'opponentBetWhenChecked',
  'opponentBetWhenCheckedWeight',
  'boardPaired',
  'boardFlushPossible',
  'boardStraightPossible',
] as const

export const VALUE_MODEL_TUNING = {
  equityTrials: 100,
  statsPriorWeight: 10,
  maximumStackToPot: 10,
  maximumBetToPot: 2,
} as const

/** The one opponent still in the hand after the flop, or null when more remain. */
export function headsUpOpponent(observation: BotObservationV1): string | null {
  if (observation.street === 'preflop') return null
  const others = observation.seats.filter(
    (seat) =>
      seat.playerId !== null && seat.playerId !== observation.actor.playerId && !seat.folded,
  )
  return others.length === 1 ? (others[0]?.playerId ?? null) : null
}

export function valueFeatures(observation: BotObservationV1): number[] | null {
  const opponentId = headsUpOpponent(observation)
  if (opponentId === null) return null
  const { actor, board, amountToCall, pot, street } = observation
  const opponent = observation.seats.find((seat) => seat.playerId === opponentId)
  if (opponent === undefined || actor.hole.length !== 2) return null
  const hole = actor.hole as [
    BotObservationV1['actor']['hole'][number],
    BotObservationV1['actor']['hole'][number],
  ]
  const seed = `${observation.roomId}:${observation.handNumber}:${street}:${observation.actions?.length ?? 0}`
  const equity = (tight: boolean): number => {
    try {
      return estimateShowdownEquity({
        hole,
        board,
        opponents: 1,
        seed: `${seed}:${tight ? 'tight' : 'random'}`,
        trials: VALUE_MODEL_TUNING.equityTrials,
        ...(tight ? { ranges: ['tight'] as const } : {}),
      }).potShare
    } catch {
      return Number.NaN
    }
  }
  const random = equity(false)
  const tight = equity(true)
  const holding = holdingOf(actor.hole, board)
  const texture = boardTexture(board)
  const seats = observation.seats.length
  const order = (seat: number) =>
    observation.dealerSeat === undefined ? 0 : (seat - observation.dealerSeat - 1 + seats) % seats
  const summary =
    observation.actions === undefined ? null : summarisePublicActions(observation.actions, street)
  const opponentAggressor = summary !== null && summary.lastAggressorSeat === opponent.seat
  const stats = observation.opponentStats?.find((entry) => entry.playerId === opponentId)
  const weight = (opportunities: number) =>
    opportunities / (opportunities + VALUE_MODEL_TUNING.statsPriorWeight)
  const effectiveStack = Math.min(actor.stack, opponent.stack + opponent.betStreet)
  return [
    Number(street === 'flop'),
    Number(street === 'turn'),
    Number(street === 'river'),
    Number(holding === 'air'),
    Number(holding === 'draw'),
    Number(holding === 'pair'),
    Number(holding === 'strong'),
    random,
    Number.isNaN(tight) ? random : tight,
    amountToCall / Math.max(1, pot + amountToCall),
    Math.min(VALUE_MODEL_TUNING.maximumBetToPot, amountToCall / Math.max(1, pot)),
    Math.min(VALUE_MODEL_TUNING.maximumStackToPot, effectiveStack / Math.max(1, pot)) /
      VALUE_MODEL_TUNING.maximumStackToPot,
    Number(order(actor.seat) > order(opponent.seat)),
    Number(opponentAggressor && (summary?.raisesThisStreet ?? 0) > 0),
    opponentAggressor ? Math.min(3, summary?.consecutiveAggressiveStreets ?? 0) / 3 : 0,
    stats?.foldToBet.mean ?? 0.4,
    weight(stats?.foldToBet.opportunities ?? 0),
    stats?.betWhenCheckedTo.mean ?? 0.35,
    weight(stats?.betWhenCheckedTo.opportunities ?? 0),
    Number(texture.rankPattern !== 'unpaired'),
    Number(texture.maxSameSuit >= 3),
    Number(texture.maxStraightWindowRanks >= 3),
  ]
}

/** A one-hidden-layer network with standardised inputs and one output per action bucket. */
export interface ValueNetwork {
  readonly inputs: number
  readonly hidden: number
  readonly outputs: number
  readonly mean: readonly number[]
  readonly scale: readonly number[]
  readonly w1: readonly number[]
  readonly b1: readonly number[]
  readonly w2: readonly number[]
  readonly b2: readonly number[]
}

export interface ValueExample {
  readonly x: readonly number[]
  readonly targets: readonly (number | null)[]
}

export interface TrainingOptions {
  readonly hidden: number
  readonly epochs: number
  readonly batch: number
  readonly learningRate: number
  readonly l2: number
  readonly huberDelta: number
  readonly seed: number
}

export function predict(network: ValueNetwork, x: readonly number[]): number[] {
  return forward(network, standardise(network, x)).output
}

function standardise(network: Pick<ValueNetwork, 'mean' | 'scale'>, x: readonly number[]) {
  return x.map((value, index) => (value - (network.mean[index] ?? 0)) / (network.scale[index] ?? 1))
}

function forward(network: ValueNetwork, z: readonly number[]) {
  const hidden = new Array<number>(network.hidden)
  for (let h = 0; h < network.hidden; h += 1) {
    let sum = network.b1[h] ?? 0
    for (let i = 0; i < network.inputs; i += 1) {
      sum += (network.w1[h * network.inputs + i] ?? 0) * (z[i] ?? 0)
    }
    hidden[h] = Math.max(0, sum)
  }
  const output = new Array<number>(network.outputs)
  for (let o = 0; o < network.outputs; o += 1) {
    let sum = network.b2[o] ?? 0
    for (let h = 0; h < network.hidden; h += 1) {
      sum += (network.w2[o * network.hidden + h] ?? 0) * (hidden[h] ?? 0)
    }
    output[o] = sum
  }
  return { hidden, output }
}

/**
 * Deterministic minibatch Adam on a masked Huber loss: only the buckets that
 * were legal, and so rolled out, carry a target.
 */
export function trainValueNetwork(
  examples: readonly ValueExample[],
  options: TrainingOptions,
): ValueNetwork {
  const first = examples[0]
  if (first === undefined) throw new Error('no training examples')
  const inputs = first.x.length
  const outputs = first.targets.length
  const mean = Array.from(
    { length: inputs },
    (_, i) => examples.reduce((sum, example) => sum + (example.x[i] ?? 0), 0) / examples.length,
  )
  const scale = Array.from({ length: inputs }, (_, i) => {
    const variance =
      examples.reduce((sum, example) => sum + ((example.x[i] ?? 0) - (mean[i] ?? 0)) ** 2, 0) /
      examples.length
    return Math.sqrt(variance) > 1e-9 ? Math.sqrt(variance) : 1
  })
  const rng: Rng = mulberry32(options.seed)
  const init = (fanIn: number) => (rng() * 2 - 1) * Math.sqrt(6 / fanIn)
  const params = {
    w1: Array.from({ length: options.hidden * inputs }, () => init(inputs)),
    b1: new Array<number>(options.hidden).fill(0),
    w2: Array.from({ length: outputs * options.hidden }, () => init(options.hidden)),
    b2: new Array<number>(outputs).fill(0),
  }
  const moments = Object.fromEntries(
    Object.entries(params).map(([name, values]) => [
      name,
      { m: new Array<number>(values.length).fill(0), v: new Array<number>(values.length).fill(0) },
    ]),
  ) as Record<keyof typeof params, { m: number[]; v: number[] }>
  const standardised = examples.map((example) => ({
    z: standardise({ mean, scale }, example.x),
    targets: example.targets,
  }))
  const order = standardised.map((_, index) => index)
  let step = 0
  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1))
      ;[order[index], order[swap]] = [order[swap] as number, order[index] as number]
    }
    for (let start = 0; start < order.length; start += options.batch) {
      const grads = {
        w1: new Array<number>(params.w1.length).fill(0),
        b1: new Array<number>(params.b1.length).fill(0),
        w2: new Array<number>(params.w2.length).fill(0),
        b2: new Array<number>(params.b2.length).fill(0),
      }
      const batch = order.slice(start, start + options.batch)
      const network: ValueNetwork = {
        inputs,
        hidden: options.hidden,
        outputs,
        mean,
        scale,
        ...params,
      }
      for (const exampleIndex of batch) {
        const example = standardised[exampleIndex]
        if (example === undefined) continue
        const { hidden, output } = forward(network, example.z)
        const hiddenGrad = new Array<number>(options.hidden).fill(0)
        for (let o = 0; o < outputs; o += 1) {
          const target = example.targets[o]
          if (target === null || target === undefined) continue
          const error = (output[o] ?? 0) - target
          const grad = Math.max(-options.huberDelta, Math.min(options.huberDelta, error))
          grads.b2[o] = (grads.b2[o] ?? 0) + grad
          for (let h = 0; h < options.hidden; h += 1) {
            grads.w2[o * options.hidden + h] =
              (grads.w2[o * options.hidden + h] ?? 0) + grad * (hidden[h] ?? 0)
            hiddenGrad[h] = (hiddenGrad[h] ?? 0) + grad * (params.w2[o * options.hidden + h] ?? 0)
          }
        }
        for (let h = 0; h < options.hidden; h += 1) {
          if ((hidden[h] ?? 0) <= 0) continue
          grads.b1[h] = (grads.b1[h] ?? 0) + (hiddenGrad[h] ?? 0)
          for (let i = 0; i < inputs; i += 1) {
            grads.w1[h * inputs + i] =
              (grads.w1[h * inputs + i] ?? 0) + (hiddenGrad[h] ?? 0) * (example.z[i] ?? 0)
          }
        }
      }
      step += 1
      for (const name of ['w1', 'b1', 'w2', 'b2'] as const) {
        const values = params[name]
        const { m, v } = moments[name]
        for (let k = 0; k < values.length; k += 1) {
          const decay = name.startsWith('w') ? options.l2 * (values[k] ?? 0) : 0
          const g = (grads[name][k] ?? 0) / batch.length + decay
          m[k] = 0.9 * (m[k] ?? 0) + 0.1 * g
          v[k] = 0.999 * (v[k] ?? 0) + 0.001 * g * g
          const mHat = (m[k] ?? 0) / (1 - 0.9 ** step)
          const vHat = (v[k] ?? 0) / (1 - 0.999 ** step)
          values[k] = (values[k] ?? 0) - (options.learningRate * mHat) / (Math.sqrt(vHat) + 1e-8)
        }
      }
    }
  }
  return { inputs, hidden: options.hidden, outputs, mean, scale, ...params }
}

export interface ValueModel {
  readonly version: 1
  readonly features: readonly string[]
  readonly networks: Readonly<Record<Situation, ValueNetwork>>
}

/**
 * An OG that takes a learned model's action only where the model rates it
 * clearly above the base policy's own choice.
 *
 * Preflop, multiway and anything the model cannot read fall straight through
 * to the base decision, and the server still legalises whatever comes out.
 */
export function learnedValuePolicy(
  model: ValueModel,
  options: {
    readonly base: BotPolicy
    readonly margins: Readonly<Record<Situation, number>>
    readonly onOverride?: (from: number, to: number) => void
  },
): BotPolicy {
  return {
    id: 'learned-value-candidate',
    version: 1,
    decide(context) {
      const envelope = options.base.decide(context)
      const keep = { ...envelope, policyId: this.id, policyVersion: this.version }
      if (context.profile.skill !== 'og') return keep
      const { observation } = context
      const features = valueFeatures(observation)
      if (features === null || features.some((value) => !Number.isFinite(value))) return keep
      const situation = situationOf(observation)
      const values = predict(model.networks[situation], features)
      const current = bucketOf(observation, envelope.decision)
      let best = current
      for (let bucket = 0; bucket < values.length; bucket += 1) {
        if (bucketAction(observation, bucket) === null) continue
        if ((values[bucket] ?? 0) > (values[best] ?? 0)) best = bucket
      }
      if (
        best === current ||
        (values[best] ?? 0) - (values[current] ?? 0) <= options.margins[situation]
      ) {
        return keep
      }
      const action = bucketAction(observation, best)
      if (action === null) return keep
      options.onOverride?.(current, best)
      return { ...keep, decision: action as BotDecision }
    },
  }
}
