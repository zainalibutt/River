import {
  type BotDecision,
  type BotObservationV1,
  type BotPersonality,
  type BotPolicy,
  type BotPolicyContextV1,
  type Card,
  cardKey,
} from '@river/engine'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import {
  cardBlindShare,
  combosOf,
  decisionFor,
  nearestStrength,
  RIVER_CANDIDATE_TUNING,
  RIVER_POLICY_TUNING,
  type RiverPolicyTuning,
  type RiverReads,
  readsModel,
  riverReads,
  trackRanges,
  translate,
} from './bot-river-policy.js'
import {
  comboIndex,
  type Hands,
  type Player,
  prepare,
  type RiverNode,
  type RiverSpot,
} from './bot-river-solver.js'
import { solveTurn } from './bot-turn-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'

/**
 * v9a: the OG solves two-player turns (docs/bots.md). At a two-player turn
 * where the OG is to act, it rebuilds both players' ranges from the public
 * moves as the river policy does, solves the turn's betting with the
 * turn-end network valuing what follows, and plays its holding's row of the
 * solution. Anywhere else, or when the hand cannot be followed, it plays the
 * base policy: for v9a that is v8z, which solves the river and plays v6 before
 * it. With reads on, the turn is solved as v8z solves the river against an
 * opponent with known habits: the opponent follows what the reads say with the
 * trust the evidence earns, and plays freely otherwise, a restricted Nash
 * response, so a wrong read costs little.
 */
export interface TurnPolicyTuning {
  /** Bet and raise sizes as shares of the pot, beside all-in. */
  readonly betSizes: readonly number[]
  readonly maxRaises: number
  readonly iterations: number
  readonly cacheSize: number
  /** How the ranges are tracked through the hand so far, and the reads, as v8z has them. */
  readonly ranges: RiverPolicyTuning
  /** Bend the turn's solution towards what the reads say about the opponent. */
  readonly reads: boolean
}

export const TURN_POLICY_TUNING: TurnPolicyTuning = {
  betSizes: [0.66],
  maxRaises: 1,
  iterations: 100,
  cacheSize: 64,
  ranges: { ...RIVER_POLICY_TUNING, ...RIVER_CANDIDATE_TUNING },
  reads: false,
}

export interface TurnPolicyStats {
  solved: number
  fallbacks: Record<string, number>
  solves: number
  trackMs: number
  solveMs: number
}

interface SolvedTurn {
  readonly spot: RiverSpot
  readonly tree: RiverNode
  readonly strategy: ReadonlyMap<string, Float64Array>
  readonly hands: readonly [Hands, Hands]
  readonly players: readonly [string, string]
}

export function turnSolverPolicy(
  base: BotPolicy,
  network: RiverValueNetwork,
  id: string,
  version: number,
  overrides: Partial<TurnPolicyTuning> = {},
): { readonly policy: BotPolicy; readonly stats: TurnPolicyStats } {
  const tuning: TurnPolicyTuning = { ...TURN_POLICY_TUNING, ...overrides }
  const stats: TurnPolicyStats = { solved: 0, fallbacks: {}, solves: 0, trackMs: 0, solveMs: 0 }
  const cache = new Map<string, SolvedTurn | string>()
  const policy: BotPolicy = {
    id,
    version,
    decide(context) {
      const baseline = () => ({ ...base.decide(context), policyId: id, policyVersion: version })
      if (context.observation.street !== 'turn' || context.profile.skill !== 'og') {
        return baseline()
      }
      const result = turnDecision(context, base, network, tuning, cache, stats)
      if (typeof result === 'string') {
        stats.fallbacks[result] = (stats.fallbacks[result] ?? 0) + 1
        return baseline()
      }
      stats.solved += 1
      return {
        policyId: id,
        policyVersion: version,
        observationVersion: context.observation.version,
        decision: result,
        fallbackReason: null,
      }
    },
  }
  return { policy, stats }
}

function turnDecision(
  context: BotPolicyContextV1,
  base: BotPolicy,
  network: RiverValueNetwork,
  tuning: TurnPolicyTuning,
  cache: Map<string, SolvedTurn | string>,
  stats: TurnPolicyStats,
): BotDecision | string {
  const { observation, personality } = context
  const live = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
  if (live.length !== 2) return 'not heads-up'
  if (observation.board.length !== 4) return 'not a turn board'
  const decisions = publicDecisions(observation, (playerId) =>
    playerId === observation.actor.playerId
      ? {
          opponents: observation.opponents,
          ...(observation.opponentStats === undefined
            ? {}
            : { opponentStats: observation.opponentStats }),
          tilt: observation.tilt,
        }
      : {},
  )
  if (decisions === null) return 'replay failed'
  const turnStart = decisions.findIndex((decision) => decision.taken.street === 'turn')
  const preTurn = turnStart === -1 ? decisions : decisions.slice(0, turnStart)
  const key = [
    personality.id,
    observation.tilt.factor,
    observation.dealerSeat,
    observation.board.map(cardKey).join(','),
    observation.seats.map((seat) => `${seat.seat}:${seat.playerId}:${seat.stack + seat.betHand}`),
    JSON.stringify(preTurn.map((decision) => decision.taken)),
  ].join('|')
  const opponentId = live.find((seat) => seat.playerId !== observation.actor.playerId)?.playerId
  const read = observation.opponents.find((summary) => summary.playerId === opponentId)
  const doubt = cardBlindShare(read, 'aggressive', tuning.ranges)
  const reads = tuning.reads
    ? riverReads(
        observation.opponentStats?.find((entry) => entry.playerId === opponentId),
        read,
        tuning.ranges,
      )
    : null
  const cacheKey = `${key}|${observation.actor.playerId}|${doubt.toFixed(4)}${
    reads === null ? '' : `|${Object.values(reads).map((value) => value.toFixed(4))}`
  }`
  let solved = cache.get(cacheKey)
  if (solved === undefined) {
    solved = solveTurnSpot(
      observation,
      preTurn,
      live,
      base,
      network,
      personality,
      key,
      tuning,
      stats,
      reads,
    )
    cache.set(cacheKey, solved)
    if (cache.size > tuning.cacheSize) cache.delete(cache.keys().next().value as string)
  }
  if (typeof solved === 'string') return solved
  const firstActor = (decisions[turnStart] ?? { observation }).observation.actor.playerId
  if (firstActor !== solved.players[0]) return 'order mismatch'
  const self: Player = solved.players[0] === observation.actor.playerId ? 0 : 1
  let node = solved.tree
  for (const decision of turnStart === -1 ? [] : decisions.slice(turnStart)) {
    if (node.kind !== 'action') return 'off tree'
    const index = node.actions.indexOf(translate(node, decision, solved.spot))
    if (index === -1) return 'off tree'
    node = node.children[index] as RiverNode
  }
  if (node.kind !== 'action' || node.player !== self) return 'off tree'
  const table = solved.strategy.get(node.history)
  const hole = observation.actor.hole
  if (table === undefined || hole.length !== 2) return 'no strategy'
  const hands = solved.hands[self]
  const index =
    comboIndex(hands, hole as [Card, Card]) ?? nearestStrength(hands, hole, observation.board)
  const width = node.actions.length
  const row = table.subarray(index * width, (index + 1) * width)
  const roll = context.rng()
  let pick = row.length - 1
  let cumulative = 0
  for (let action = 0; action < row.length; action += 1) {
    cumulative += row[action] as number
    if (roll < cumulative) {
      pick = action
      break
    }
  }
  return decisionFor(node, node.actions[pick] as string, solved.spot, observation)
}

function solveTurnSpot(
  observation: BotObservationV1,
  preTurn: readonly PublicDecision[],
  live: BotObservationV1['seats'],
  base: BotPolicy,
  network: RiverValueNetwork,
  personality: BotPersonality,
  key: string,
  tuning: TurnPolicyTuning,
  stats: TurnPolicyStats,
  reads: RiverReads | null,
): SolvedTurn | string {
  const stack = Math.min(...live.map((seat) => seat.stack + seat.betStreet))
  if (stack <= 0) return 'all-in'
  const pot = observation.pot - observation.seats.reduce((sum, seat) => sum + seat.betStreet, 0)
  const dealer = observation.dealerSeat ?? -1
  const [low, high] = [...live].sort((a, b) => a.seat - b.seat) as [
    (typeof live)[number],
    (typeof live)[number],
  ]
  const first = dealer >= low.seat && dealer < high.seat ? high : low
  const second = first === low ? high : low
  const players = [first.playerId as string, second.playerId as string] as const
  const started = performance.now()
  const opponent = players[0] === observation.actor.playerId ? 1 : 0
  const read = observation.opponents.find((summary) => summary.playerId === players[opponent])
  const ranges = trackRanges(
    observation.board,
    preTurn,
    players,
    base,
    personality,
    key,
    tuning.ranges.minimumWeightShare,
    (decision, taken) =>
      decision.observation.actor.playerId === players[opponent]
        ? cardBlindShare(read, taken, tuning.ranges)
        : 0,
  )
  const tracked = performance.now()
  stats.trackMs += tracked - started
  const spot: RiverSpot = {
    board: observation.board,
    pot,
    stack,
    ranges: [combosOf(ranges[0]), combosOf(ranges[1])],
    betSizes: tuning.betSizes,
    allIn: true,
    maxRaises: tuning.maxRaises,
  }
  if (spot.ranges[0].length === 0 || spot.ranges[1].length === 0) return 'empty range'
  const model = reads === null || reads.trust <= 0 ? undefined : readsModel(reads, spot, opponent)
  const solution = solveTurn(spot, tuning.iterations, network, model)
  stats.solveMs += performance.now() - tracked
  stats.solves += 1
  return {
    spot,
    tree: solution.tree,
    strategy: solution.strategy,
    hands: [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)],
    players,
  }
}
