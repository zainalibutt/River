import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BotObservationV1, cardKey, type TurnAction } from '@river/engine'
import {
  AIVAT_NETWORK_HEURISTICS,
  type AivatNetworkVersion,
  type AivatRangeState,
  type AivatValueHeuristic,
  frozenPotShare,
} from './bot-aivat.js'
import { flopLayout } from './bot-flop-buckets.js'
import { comboIndex52, strengthRanks } from './bot-river-value-data.js'
import { expectedStrengthRanks, turnLayout, turnRivers } from './bot-turn-end-data.js'
import {
  type BucketLayout,
  bucketInputs,
  bucketsFromRanks,
  forward,
  loadValueNetwork,
  type RiverValueNetwork,
  rangeWeights,
} from './bot-value-network.js'

/** Each network estimator is pinned in the benchmark spec it was frozen with. */
export const aivatSpecification = (version: AivatNetworkVersion) =>
  new URL(`../benchmark/frozen-${version}.json`, import.meta.url)
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const layouts = new WeakMap<RiverValueNetwork, Map<string, BucketLayout>>()

/** Uses training's exact bucket construction; cache is bounded and contains no outcomes. */
function layoutFor(network: RiverValueNetwork, observation: BotObservationV1): BucketLayout {
  let cache = layouts.get(network)
  if (!cache) {
    cache = new Map()
    layouts.set(network, cache)
  }
  const key = observation.board.map(cardKey).join(',')
  const hit = cache.get(key)
  if (hit) return hit
  const board = observation.board
  const layout =
    board.length === 5
      ? bucketsFromRanks(strengthRanks(board), network.buckets)
      : board.length === 4
        ? turnLayout(turnRivers(board), network)
        : flopLayout(board, expectedStrengthRanks(turnRivers(board)), network)
  if (cache.size >= 8) cache.delete(cache.keys().next().value as string)
  cache.set(key, layout)
  return layout
}

/** Frozen Q projection: opponent matches our contribution where possible, then
 * evaluate that pot/stack with PRE-action tracked ranges. Network values are in
 * pots (not centered utilities); subtract our full hand contribution once.
 * This deliberately approximate projection assumes no fold equity. It is a
 * function of pre-action information and the alternative, never the sampled
 * action, future board, opponent holding or terminal result. */
export function networkActionValue(
  network: RiverValueNetwork,
  observation: BotObservationV1,
  action: TurnAction,
  state: AivatRangeState,
): number {
  if (![3, 4, 5].includes(observation.board.length) || network.checked !== undefined)
    throw new Error('AIVAT v2 requires an unchecked postflop network')
  const actor = observation.seats.find((seat) => seat.seat === observation.actor.seat)
  const others = observation.seats.filter(
    (seat) => seat.playerId !== null && !seat.folded && seat.seat !== observation.actor.seat,
  )
  const other = others[0]
  if (!actor || !other || others.length !== 1 || observation.actor.hole.length !== 2)
    throw new Error('AIVAT v2 requires heads-up public state')
  if (action.kind === 'fold') return -actor.betHand
  const cost =
    action.kind === 'call'
      ? Math.min(actor.stack, observation.amountToCall)
      : action.kind === 'allIn'
        ? actor.stack
        : action.kind === 'raiseTo'
          ? action.to - actor.betStreet
          : 0
  if (!Number.isFinite(cost) || cost < 0 || cost > actor.stack)
    throw new Error('invalid AIVAT alternative cost')
  const match = Math.min(other.stack, Math.max(0, actor.betStreet + cost - other.betStreet))
  const pot = observation.seats.reduce((sum, seat) => sum + seat.betHand, 0) + cost + match
  const stack = Math.min(actor.stack - cost, other.stack - match)
  const blocked = new Set(observation.board.map(cardKey))
  for (const range of state.ranges) {
    for (const combo of range) {
      if (!Number.isFinite(combo.weight) || combo.weight < 0)
        throw new Error('invalid AIVAT range weight')
    }
  }
  const unblocked = (range: AivatRangeState['ranges'][number]) =>
    range.filter((combo) => combo.hole.every((card) => !blocked.has(cardKey(card))))
  const ranges = [unblocked(state.ranges[0]), unblocked(state.ranges[1])] as const
  const weights = rangeWeights({ ranges })
  const layout = layoutFor(network, observation)
  const hole = observation.actor.hole
  const index = comboIndex52(
    cardKey(hole[0] as NonNullable<(typeof hole)[0]>),
    cardKey(hole[1] as NonNullable<(typeof hole)[1]>),
  )
  const bucket = layout.bucketOf[index] as number
  if (bucket < 0) throw new Error('AIVAT holding blocked by board')
  const output = forward(network, bucketInputs(layout, weights, stack, pot))
  const share = output[state.actorPlayer * network.buckets + bucket] as number
  return share * pot - actor.betHand - cost
}

/** Content-addressed exports. No training, calibration or outcome-dependent
 * coefficients. The spec is read before play and its digest travels in logs.
 * Older versions refuse to load once a pinned source changes; v4 is the live freeze. */
export function frozenNetworkHeuristic(
  modelRoot: string,
  version: AivatNetworkVersion = 'v4',
): AivatValueHeuristic {
  const id = AIVAT_NETWORK_HEURISTICS[version]
  const bytes = readFileSync(aivatSpecification(version))
  const spec = JSON.parse(bytes.toString('utf8')) as {
    estimators: {
      [key in AivatNetworkVersion]: {
        id: string
        sourceSha256: Record<string, string>
        recipe: unknown
        recipeSha256: string
        models: Record<
          'flop' | 'turn' | 'river',
          {
            stem: string
            jsonSha256: string
            binSha256: string
          }
        >
      }
    }
  }
  const frozen = spec.estimators[version]
  if (frozen?.id !== id) throw new Error(`wrong AIVAT ${version} spec`)
  if (sha256(Buffer.from(JSON.stringify(frozen.recipe))) !== frozen.recipeSha256)
    throw new Error(`AIVAT ${version} recipe hash mismatch`)
  for (const [file, hash] of Object.entries(frozen.sourceSha256)) {
    if (sha256(readFileSync(new URL(file, import.meta.url))) !== hash)
      throw new Error(`AIVAT ${version} source hash mismatch; freeze a new version`)
  }
  const networks = {} as Record<'flop' | 'turn' | 'river', RiverValueNetwork>
  for (const street of ['flop', 'turn', 'river'] as const) {
    const model = frozen.models[street]
    const stem = join(modelRoot, model.stem)
    for (const extension of ['json', 'bin'] as const) {
      if (sha256(readFileSync(`${stem}.${extension}`)) !== model[`${extension}Sha256`])
        throw new Error(`AIVAT ${version} ${street} ${extension} hash mismatch`)
    }
    networks[street] = loadValueNetwork(stem)
  }
  return Object.freeze({
    id,
    specificationSha256: sha256(bytes),
    value(observation, action, state) {
      if (observation.street === 'preflop') {
        const share = frozenPotShare(observation.actor.hole, observation.board)
        const actor = observation.actor
        const cost =
          action.kind === 'call'
            ? Math.min(actor.stack, observation.amountToCall)
            : action.kind === 'allIn'
              ? actor.stack
              : action.kind === 'raiseTo'
                ? action.to - actor.betStreet
                : 0
        const seat = observation.seats.find((entry) => entry.seat === actor.seat)
        if (!seat) throw new Error('AIVAT actor missing')
        const pot = observation.seats.reduce((sum, entry) => sum + entry.betHand, 0)
        return action.kind === 'fold' ? -seat.betHand : share * (pot + cost) - seat.betHand - cost
      }
      if (!state) throw new Error(`AIVAT ${version} tracked ranges unavailable`)
      return networkActionValue(networks[observation.street], observation, action, state)
    },
  } satisfies AivatValueHeuristic)
}

let selected: AivatValueHeuristic | undefined
let selectedKey: string | undefined
/** Benchmark opt-in; v1 remains the default. Loading happens before a decision. */
export function aivatHeuristicFromEnvironment(): AivatValueHeuristic | undefined {
  const version = process.env.RIVER_AIVAT_HEURISTIC ?? 'v1'
  if (version === 'v1') return undefined
  if (version !== 'v2' && version !== 'v3' && version !== 'v4')
    throw new Error('RIVER_AIVAT_HEURISTIC must be v1, v2, v3 or v4')
  const root = process.env.RIVER_AIVAT_MODEL_ROOT
  if (!root) throw new Error(`AIVAT ${version} needs RIVER_AIVAT_MODEL_ROOT`)
  const key = `${version}:${root}`
  if (!selected || selectedKey !== key) {
    selected = frozenNetworkHeuristic(root, version)
    selectedKey = key
  }
  return selected
}
