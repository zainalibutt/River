import {
  type BotDecision,
  type BotObservationV1,
  type BotPersonality,
  type BotPolicy,
  type BotPolicyContextV1,
  type Card,
  cardKey,
  cardToString,
} from '@river/engine'
import { captureCumulativeStrategy } from './bot-aivat.js'
import { aivatSolverState } from './bot-aivat-state.js'
import {
  flopDecisionReach,
  flopDiagnosticsFromEnvironment,
  flopIpJamOverRaise,
} from './bot-flop-diagnostics.js'
import { solveFlop } from './bot-flop-solver.js'
import { perTurnShowdown, type TurnStartLeafOptions } from './bot-flop-turn-leaves.js'
import { type LbrQueryPolicy, memoLbrSolve, policyMoveShares } from './bot-lbr-query.js'
import { decisionClass, type MoveClass } from './bot-lbr-range.js'
import {
  followWithResolving,
  type OffTreeState,
  type OffTreeStats,
  offTreeStats,
} from './bot-off-tree.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { type HandAwareBotPolicy, HandSolveCache, releasePolicyHand } from './bot-policy-hand.js'
import type { TablePreflopSource } from './bot-preflop-tables.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { carryFromRecord, exactTurnAction, type RiverCarrySource } from './bot-river-carry.js'
import {
  cardBlindShare,
  combosOf,
  combosWithFloor,
  decisionFor,
  FULL_SUPPORT_SHARE,
  type KnownShares,
  nearestStrength,
  RIVER_CANDIDATE_TUNING,
  RIVER_POLICY_TUNING,
  type RiverPolicyStats,
  type RiverPolicyTuning,
  type RiverReads,
  readsModel,
  riverReads,
  riverSolverPolicy,
  trackRanges,
  translate,
} from './bot-river-policy.js'
import {
  type CfrOptions,
  comboIndex,
  type Hands,
  type Player,
  prepare,
  type RiverGadget,
  type RiverNode,
  type RiverOpponentModel,
  type RiverSolution,
  type RiverSpot,
  riverValues,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'
import {
  SAFE_TURN_EXPLOIT_CONFIG,
  type SafeTurnExploitConfig,
  solveBudgetedTurnDecision,
  turnExploitBudget,
} from './bot-safe-turn-exploitation.js'
import { solveCacheMemory } from './bot-solver-memory.js'
import {
  createRiverPromiseRecord,
  perRiverShowdown,
  type RiverPromiseRecord,
} from './bot-turn-river-leaves.js'
import { turnShowdown } from './bot-turn-solver.js'
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
export interface TurnPolicyTuning extends CfrOptions {
  /** River optimization; separately opt in to the one-decision turn envelope. */
  readonly safeExploitV2?: boolean
  readonly safeTurnExploit?: boolean
  readonly safeTurnExploitConfig?: Partial<SafeTurnExploitConfig>
  readonly safeExploitConfig?: Partial<import('./bot-safe-exploitation.js').SafeExploitConfig>
  readonly preflop?: TablePreflopSource
  readonly offTree?: 'resolve'
  readonly boundedReads?: boolean
  readonly baselineCaps?: boolean
  readonly carry?: 'per-river' | 'per-turn' | 'both'
  readonly riverNetwork?: RiverValueNetwork
  readonly turnStartNetwork?: RiverValueNetwork
  readonly turnStartLeaf?: TurnStartLeafOptions
  /** Bet and raise sizes as shares of the pot, beside all-in. */
  readonly betSizes: readonly number[]
  /** Flop-only override; inherited by exact-size off-tree widening. */
  readonly flopBetSizes?: readonly number[]
  readonly maxRaises: number
  readonly iterations: number
  /** Completed-spot limit without carry; carry solves stay pinned until the hand settles. */
  readonly cacheSize: number
  /** How the ranges are tracked through the hand so far, and the reads, as v8z has them. */
  readonly ranges: RiverPolicyTuning
  /** Bend the turn's solution towards what the reads say about the opponent. */
  readonly reads: boolean
  /** Play the base policy's turn once the reads' trust in what they know about the opponent reaches this; null always solves. */
  readonly predictableTrust: number | null
}

export const TURN_POLICY_TUNING: TurnPolicyTuning = {
  betSizes: [0.66],
  maxRaises: 1,
  iterations: 100,
  cacheSize: 64,
  ranges: { ...RIVER_POLICY_TUNING, ...RIVER_CANDIDATE_TUNING },
  reads: false,
  predictableTrust: null,
}

export interface TurnPolicyStats {
  readonly safeExploit: RiverPolicyStats['safeExploit']
  readonly offTree: OffTreeStats
  carryUsed: number
  carryFallbacks: number
  solved: number
  fallbacks: Record<string, number>
  solves: number
  trackMs: number
  solveMs: number
  maxSolveMs: number
}

/**
 * Which street a solver policy plays, and how. `known` gives the exact share of
 * each holding behind earlier streets' moves where a solver made them, so the
 * ranges this street starts from are the ones those solves played. With `safe`,
 * the street is solved twice: once for the ranges as tracked, which gives each
 * opponent holding a promise, and again with the re-solving gadget from those
 * promises, which plays without trusting the opponent's range (`RiverGadget`).
 */
export interface StreetSetup {
  readonly street: 'flop' | 'turn'
  readonly solve: (
    spot: RiverSpot,
    iterations: number,
    network: RiverValueNetwork,
    model?: RiverOpponentModel,
    gadget?: RiverGadget,
    options?: CfrOptions,
  ) => RiverSolution
  readonly known: KnownShares
  readonly safe: boolean
  readonly carry?: RiverCarrySource
}

export const TURN_STREET: StreetSetup = {
  street: 'turn',
  solve: (spot, iterations, network, model, gadget, options) =>
    solveRiver(spot, iterations, model, turnShowdown(spot, network), gadget, undefined, options),
  known: () => null,
  safe: false,
}

export const FLOP_STREET: StreetSetup = {
  street: 'flop',
  solve: (spot, iterations, network, model, gadget, options) => {
    if (model !== undefined) throw new Error('the flop solver takes no opponent model')
    return solveFlop(spot, iterations, network, gadget, undefined, options)
  },
  known: () => null,
  safe: false,
}

const BOARD_CARDS = { flop: 3, turn: 4 } as const

interface SolvedTurn {
  /** Shadow tables/records above remain immutable for all later decisions. */
  readonly exploit?: {
    attempted: boolean
    selected?: { history: string; table: Float64Array }
    reference: RiverSolution
    readonly showdown: ShowdownValues | undefined
    readonly reads: RiverReads | null
    readonly posterior: () => readonly import('./bot-river-solver.js').RangeCombo[]
  }
  readonly offTree?: OffTreeState<SolvedTurn>
  readonly spot: RiverSpot
  readonly tree: RiverNode
  readonly strategy: ReadonlyMap<string, Float64Array>
  readonly hands: readonly [Hands, Hands]
  readonly players: readonly [string, string]
  readonly record?: RiverPromiseRecord
  readonly gadgetFollow?: { readonly player: Player; readonly share: Float64Array }
}

export function turnSolverPolicy(
  base: BotPolicy,
  network: RiverValueNetwork,
  id: string,
  version: number,
  overrides: Partial<TurnPolicyTuning> = {},
  street: StreetSetup = TURN_STREET,
): {
  readonly policy: HandAwareBotPolicy & LbrQueryPolicy
  readonly stats: TurnPolicyStats
  readonly carried: RiverCarrySource
  readonly cacheMemory: () => ReturnType<typeof solveCacheMemory>
  /** For one of this policy's past turn moves, the share of each holding that makes it. */
  readonly ownShares: (
    decision: PublicDecision,
    taken: MoveClass,
    personality: BotPersonality,
    /** The share of the very action played, not of every action of its class. */
    exact?: boolean,
  ) => ((hole: readonly [Card, Card]) => number) | null
  /**
   * For one of the opponent's past turn moves, the share of each of their
   * holdings that makes it in this policy's own solve of that turn: the range
   * the solve's equilibrium hands the river, rather than a guess at how they
   * play. `history` is the hand's decisions, which include this policy's own
   * turn move that the solve was made for.
   */
  readonly opponentShares: (
    decision: PublicDecision,
    taken: MoveClass,
    personality: BotPersonality,
    history: readonly PublicDecision[],
    exact?: boolean,
  ) => ((hole: readonly [Card, Card]) => number) | null
  /** What the solve says at this observation's turn decision, or why there is none. */
  readonly explain: (
    observation: BotObservationV1,
    personality: BotPersonality,
    fullRange?: boolean,
  ) => TurnExplanation | string
} {
  const tuning: TurnPolicyTuning = { ...TURN_POLICY_TUNING, ...overrides }
  if (street.street === 'flop') flopDiagnosticsFromEnvironment()
  const stats: TurnPolicyStats = {
    safeExploit: {
      eligible: 0,
      proposed: 0,
      accepted: 0,
      auditFailures: 0,
      actionTV: 0,
      modelEVGain: 0,
      budgetSpent: 0,
      maxBRIncrease: 0,
      latencyMs: 0,
      roots: [],
    },
    offTree: offTreeStats(),
    carryUsed: 0,
    carryFallbacks: 0,
    solved: 0,
    fallbacks: {},
    solves: 0,
    trackMs: 0,
    solveMs: 0,
    maxSolveMs: 0,
  }
  const cache = new HandSolveCache<SolvedTurn | string>(
    tuning.safeTurnExploit === true || tuning.carry !== undefined || tuning.offTree === 'resolve',
    tuning.cacheSize,
  )
  const policy: HandAwareBotPolicy & LbrQueryPolicy = {
    id,
    version,
    moveShares(context, taken) {
      if (context.observation.street !== street.street || context.profile.skill !== 'og') {
        return policyMoveShares(base, context, taken)
      }
      // The optional exploit can select a different table at the decision itself.
      // Use sampled decisions there rather than report the baseline as exact.
      if (tuning.safeTurnExploit) return null
      return ownShares(
        {
          observation: context.observation,
          taken: {
            seat: context.observation.actor.seat,
            street: context.observation.street,
            action: { kind: 'check' },
          },
        },
        taken,
        context.personality,
      )
    },
    releaseHand(roomId, handNumber) {
      cache.releaseHand(roomId, handNumber)
      releasePolicyHand(base, roomId, handNumber)
    },
    decide(context) {
      cache.observe(context.observation)
      const baseline = () => ({ ...base.decide(context), policyId: id, policyVersion: version })
      if (context.observation.street !== street.street || context.profile.skill !== 'og') {
        return baseline()
      }
      const result = turnDecision(context, base, network, tuning, cache, stats, street)
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
  // Which of a node's actions a past move counts as: the one it translates to when
  // `exact` (a 0.66-pot bet and an all-in are different evidence), else every action of
  // its class, as the blueprint's tracking does.
  const matchesFor = (
    node: Extract<RiverNode, { kind: 'action' }>,
    decision: PublicDecision,
    taken: MoveClass,
    spot: RiverSpot,
    exact: boolean,
  ): boolean[] | null => {
    if (exact) {
      const played = translate(node, decision, spot)
      if (!node.actions.includes(played)) return null
      return node.actions.map((action) => action === played)
    }
    return node.actions.map(
      (action) =>
        decisionClass(
          decisionFor(node, action, spot, decision.observation),
          decision.observation,
        ) === taken,
    )
  }
  const ownShares = (
    decision: PublicDecision,
    taken: MoveClass,
    personality: BotPersonality,
    exact = false,
  ) => {
    const { observation } = decision
    if (observation.street !== street.street) return null
    const found = locate(observation, personality, base, network, tuning, cache, stats, street)
    if (typeof found === 'string') return null
    const { solved, node, self } = found
    const table = solved.strategy.get(node.history)
    if (table === undefined) return null
    const width = node.actions.length
    const matches = matchesFor(node, decision, taken, solved.spot, exact)
    if (matches === null) return null
    const hands = solved.hands[self]
    return (hole: readonly [Card, Card]) => {
      const index =
        comboIndex(hands, hole as [Card, Card]) ?? nearestStrength(hands, hole, observation.board)
      let share = 0
      for (let action = 0; action < width; action += 1) {
        if (matches[action] === true) share += table[index * width + action] as number
      }
      return share
    }
  }
  const opponentShares = (
    decision: PublicDecision,
    taken: MoveClass,
    personality: BotPersonality,
    history: readonly PublicDecision[],
    exact = false,
  ) => {
    if (decision.observation.street !== street.street) return null
    const theirId = decision.observation.actor.playerId
    // Any of our own turn moves names the solve: they all share the hand before the turn.
    const ours = history.find(
      (entry) =>
        entry.observation.street === street.street && entry.observation.actor.playerId !== theirId,
    )
    if (ours === undefined) return null
    const found = locate(ours.observation, personality, base, network, tuning, cache, stats, street)
    if (typeof found === 'string') return null
    const { solved, self } = found
    const theirs: Player = self === 0 ? 1 : 0
    if (solved.players[theirs] !== theirId) return null
    let node: RiverNode = solved.tree
    for (const entry of history) {
      if (entry === decision) break
      if (entry.observation.street !== street.street) continue
      if (node.kind !== 'action') return null
      const index = node.actions.indexOf(translate(node, entry, solved.spot))
      if (index === -1) return null
      node = node.children[index] as RiverNode
    }
    if (node.kind !== 'action' || node.player !== theirs) return null
    const table = solved.strategy.get(node.history)
    if (table === undefined) return null
    const width = node.actions.length
    const matches = matchesFor(node, decision, taken, solved.spot, exact)
    if (matches === null) return null
    const hands = solved.hands[theirs]
    return (hole: readonly [Card, Card]) => {
      // A holding the solve left out had no weight when the turn began.
      const index = comboIndex(hands, hole as [Card, Card])
      if (index === undefined) return 0
      let share = 0
      for (let action = 0; action < width; action += 1) {
        if (matches[action] === true) share += table[index * width + action] as number
      }
      return share
    }
  }
  const explain = (
    observation: BotObservationV1,
    personality: BotPersonality,
    fullRange = false,
  ) => {
    const found = locate(observation, personality, base, network, tuning, cache, stats, street)
    if (typeof found === 'string') return found
    const { solved, node, self } = found
    const hands = solved.hands[self]
    const hole = observation.actor.hole as [Card, Card]
    const exact = comboIndex(hands, hole)
    const index = exact ?? nearestStrength(hands, hole, observation.board)
    const width = node.actions.length
    const table = solved.strategy.get(node.history)
    return {
      history: node.history,
      pot: solved.spot.pot,
      stack: solved.spot.stack,
      ranges: [solved.hands[0].combos.length, solved.hands[1].combos.length] as const,
      inRange: exact !== undefined,
      standIn: hands.combos[index]?.hole.map(cardToString).join(' ') ?? '',
      actions: node.actions,
      row:
        table === undefined ? [] : Array.from(table.subarray(index * width, (index + 1) * width)),
      spot: solved.spot,
      ...(fullRange
        ? {
            players: solved.players,
            self,
            ...(street.street === 'flop'
              ? flopDecisionReach(solved, node.history, solved.gadgetFollow)
              : {}),
            rangeStrategy: hands.combos.map((combo, h) => ({
              hole: combo.hole.map(cardToString),
              probabilities:
                table === undefined ? [] : Array.from(table.subarray(h * width, (h + 1) * width)),
            })),
          }
        : {}),
    }
  }
  const carried: RiverCarrySource = (observation, personality, history, players) => {
    const enabled =
      street.street === 'turn'
        ? tuning.carry === 'per-river' || tuning.carry === 'both'
        : tuning.carry === 'per-turn' || tuning.carry === 'both'
    if (!enabled || observation.board.length !== BOARD_CARDS[street.street] + 1) return null
    const turns = history.filter((entry) => entry.observation.street === street.street)
    const ours = turns.find(
      (entry) => entry.observation.actor.playerId === observation.actor.playerId,
    )
    if (ours === undefined) return null
    const found = locate(
      ours.observation,
      personality,
      base,
      network,
      tuning,
      cache,
      stats,
      street,
      true,
    )
    if (typeof found === 'string') return null
    const { solved, self } = found
    if (solved.record === undefined || solved.players.some((id, p) => id !== players[p]))
      return null
    if (solved.spot.board.some((c, i) => cardKey(c) !== cardKey(observation.board[i] as Card)))
      return null
    let node = solved.tree
    let leafHistory = ''
    for (const entry of turns) {
      if (
        node.kind !== 'action' ||
        solved.players[node.player] !== entry.observation.actor.playerId
      )
        return null
      const action = exactTurnAction(node, entry, solved.spot, tuning.offTree === 'resolve')
      if (action === undefined) return null
      leafHistory += action
      node = node.children[node.actions.indexOf(action)] as RiverNode
    }
    if (node.kind !== 'showdown') return null
    const pot = solved.spot.pot + node.paid[0] + node.paid[1]
    const actualPot =
      observation.pot - observation.seats.reduce((sum, seat) => sum + seat.betStreet, 0)
    if (pot !== actualPot || !solved.record.leaves.has(leafHistory)) return null
    const card = cardKey(observation.board[BOARD_CARDS[street.street]] as Card)
    // All-ins and unrecorded cards cannot provide a next-root promise.
    if (!solved.record.leaves.get(leafHistory)?.cards.has(card)) return null
    const carried = carryFromRecord(solved.record, leafHistory, card, self, {
      ...solved.spot,
      board: observation.board,
      pot,
      stack: solved.spot.stack - Math.max(...node.paid),
    })
    return carried.ranges.some((range) => range.length === 0) ? null : carried
  }
  return {
    policy,
    stats,
    ownShares,
    opponentShares,
    explain,
    carried,
    cacheMemory: () => solveCacheMemory(cache),
  }
}

/** What the solve says at one turn decision, for reading a hand by hand. */
export interface TurnExplanation {
  readonly rootCheck?: readonly number[]
  readonly reach?: readonly number[]
  readonly ipBetReach?: readonly number[]
  readonly players?: readonly [string, string]
  readonly self?: Player
  readonly rangeStrategy?: readonly { hole: readonly string[]; probabilities: readonly number[] }[]
  readonly history: string
  readonly pot: number
  readonly stack: number
  readonly ranges: readonly [number, number]
  /** Whether the OG's own holding is in its range, or the row is a stand-in's of nearest strength. */
  readonly inRange: boolean
  readonly standIn: string
  readonly actions: readonly string[]
  readonly row: readonly number[]
  /** The solved spot itself, ranges and all. */
  readonly spot: RiverSpot
}

/**
 * v9a, v9b and v9c: v8z with two-player turns solved. With `handover`, v9b, the
 * river is told the range the turn solver played rather than rebuilding it as
 * if v6 had played the turn, so the two streets agree on what the OG can hold.
 * With `opponentHandover` as well, v9c, the opponent's turn moves narrow their
 * range as the turn solve's equilibrium plays them, not as v6 would: the river
 * no longer takes a raise for the strength a rule-based player would need.
 */
export function solvedTurnPolicy(
  network: RiverValueNetwork,
  overrides: Partial<TurnPolicyTuning> = {},
  handover = false,
  opponentHandover = false,
) {
  let turn: ReturnType<typeof turnSolverPolicy> | undefined
  const river = riverSolverPolicy(
    pokerGuardPolicy,
    'river-solver',
    1,
    {
      ...RIVER_CANDIDATE_TUNING,
      ...(overrides.safeExploitV2
        ? { safeExploitV2: true, safeExploitConfig: overrides.safeExploitConfig }
        : {}),
      ...(overrides.boundedReads === undefined ? {} : { boundedReads: overrides.boundedReads }),
      ...(overrides.baselineCaps === undefined ? {} : { baselineCaps: overrides.baselineCaps }),
      ...(overrides.offTree === undefined ? {} : { offTree: overrides.offTree }),
      scheme: overrides.scheme ?? 'cfr+',
      ...(overrides.alpha === undefined ? {} : { alpha: overrides.alpha }),
      ...(overrides.beta === undefined ? {} : { beta: overrides.beta }),
      ...(overrides.gamma === undefined ? {} : { gamma: overrides.gamma }),
      ...(overrides.carry === 'per-river' || overrides.carry === 'both'
        ? { safe: true, carry: 'per-river' as const }
        : {}),
    },
    handover
      ? (decision, taken, personality) => turn?.ownShares(decision, taken, personality) ?? null
      : undefined,
    opponentHandover
      ? (decision, taken, personality, history) =>
          turn?.opponentShares(decision, taken, personality, history) ?? null
      : undefined,
    (observation, personality, history, players) =>
      turn?.carried(observation, personality, history, players) ?? null,
  )
  turn = turnSolverPolicy(river.policy, network, 'turn-solver', 1, overrides)
  return { ...turn, river: river.stats }
}

interface LocatedTurn {
  readonly solved: SolvedTurn
  readonly node: Extract<RiverNode, { kind: 'action' }>
  readonly self: Player
}

function turnDecision(
  context: BotPolicyContextV1,
  base: BotPolicy,
  network: RiverValueNetwork,
  tuning: TurnPolicyTuning,
  cache: HandSolveCache<SolvedTurn | string>,
  stats: TurnPolicyStats,
  street: StreetSetup,
): BotDecision | string {
  const { observation, personality } = context
  const found = locate(observation, personality, base, network, tuning, cache, stats, street)
  if (typeof found === 'string') return found
  const { solved, node, self } = found
  let table = solved.strategy.get(node.history)
  const hole = observation.actor.hole
  if (table === undefined || hole.length !== 2) return 'no strategy'
  const hands = solved.hands[self]
  const exploit = solved.exploit
  if (exploit && !exploit.attempted) {
    exploit.attempted = true
    const started = performance.now()
    const config = { ...SAFE_TURN_EXPLOIT_CONFIG, ...tuning.safeTurnExploitConfig }
    const bigBlind = Math.max(
      0,
      ...observation.seats.map(
        (seat) =>
          seat.betHand -
          (observation.actions ?? [])
            .filter((action) => action.seat === seat.seat)
            .reduce((sum, action) => sum + (action.amountCommitted ?? 0), 0),
      ),
    )
    const budget = turnExploitBudget(solved.spot.pot, bigBlind, config)
    let chosen: ReturnType<typeof solveBudgetedTurnDecision> | undefined
    let failures = 0
    // A stand-in holding is outside the certificate's protected own support.
    if (
      budget > 0 &&
      comboIndex(hands, hole as [Card, Card]) !== undefined &&
      exploit.reads &&
      exploit.reads.trust > 0
    ) {
      try {
        chosen = solveBudgetedTurnDecision(
          exploit.reference,
          node,
          readsModel(exploit.reads, exploit.reference.spot, self === 0 ? 1 : 0),
          exploit.posterior(),
          budget,
          config,
          exploit.showdown,
        )
        if (chosen.weight > 0) exploit.selected = { history: node.history, table: chosen.table }
      } catch {
        failures++
      }
    }
    const root = {
      proposed: chosen?.proposed ?? false,
      accepted: (chosen?.weight ?? 0) > 0,
      actionTV: chosen?.actionTV ?? 0,
      modelEVGain: chosen?.modelEVGain ?? 0,
      budget,
      budgetSpent: chosen?.maxBRIncrease ?? 0,
      maxBRIncrease: chosen?.maxBRIncrease ?? 0,
      auditFailures: (chosen?.auditFailures ?? 0) + failures,
      latencyMs: performance.now() - started,
      modelWeight: chosen?.modelWeight ?? 0,
    }
    const counters = stats.safeExploit
    counters.eligible++
    counters.proposed += Number(root.proposed)
    counters.accepted += Number(root.accepted)
    counters.actionTV += root.actionTV
    counters.modelEVGain += root.modelEVGain
    counters.budgetSpent += root.budgetSpent
    counters.maxBRIncrease = Math.max(counters.maxBRIncrease, root.maxBRIncrease)
    counters.auditFailures += root.auditFailures
    counters.latencyMs += root.latencyMs
    counters.roots.push(root)
  }
  if (exploit?.selected?.history === node.history) table = exploit.selected.table
  const index =
    comboIndex(hands, hole as [Card, Card]) ?? nearestStrength(hands, hole, observation.board)
  const width = node.actions.length
  const row = table.subarray(index * width, (index + 1) * width)
  captureCumulativeStrategy(
    context.rng,
    row,
    (index) => decisionFor(node, node.actions[index] as string, solved.spot, observation),
    1,
    () =>
      aivatSolverState(
        solved.spot,
        solved.tree,
        exploit?.selected
          ? new Map([...solved.strategy, [exploit.selected.history, exploit.selected.table]])
          : solved.strategy,
        node,
        self,
      ),
  )
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

/** The solved turn and the node this observation's player is to act at, or why there is none. */
function locate(
  observation: BotObservationV1,
  personality: BotPersonality,
  base: BotPolicy,
  network: RiverValueNetwork,
  tuning: TurnPolicyTuning,
  cache: HandSolveCache<SolvedTurn | string>,
  stats: TurnPolicyStats,
  street: StreetSetup,
  cachedOnly = false,
): LocatedTurn | string {
  const live = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
  if (live.length !== 2) return 'not heads-up'
  if (observation.board.length !== BOARD_CARDS[street.street]) return `not a ${street.street} board`
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
  const turnStart = decisions.findIndex((decision) => decision.taken.street === street.street)
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
  if (tuning.predictableTrust !== null) {
    const predictable = riverReads(
      observation.opponentStats?.find((entry) => entry.playerId === opponentId),
      read,
      tuning.ranges,
    )
    if (predictable !== null && predictable.trust >= tuning.predictableTrust) return 'predictable'
  }
  const reads =
    tuning.reads || (tuning.safeTurnExploit && street.street === 'turn')
      ? riverReads(
          observation.opponentStats?.find((entry) => entry.playerId === opponentId),
          read,
          tuning.ranges,
        )
      : null
  const cacheKey =
    tuning.offTree === 'resolve' || tuning.safeTurnExploit
      ? cache.key(observation, `${observation.actor.playerId}|${observation.board.map(cardKey)}`)
      : cache.key(
          observation,
          `${key}|${observation.actor.playerId}|${doubt.toFixed(4)}${
            reads === null ? '' : `|${Object.values(reads).map((value) => value.toFixed(4))}`
          }`,
        )
  let solved = cache.get(cacheKey)
  if (solved === undefined) {
    if (cachedOnly) return 'missing cached turn'
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
      street,
    )
    cache.put(observation, cacheKey, solved)
  }
  if (typeof solved === 'string') return solved
  const firstActor = (decisions[turnStart] ?? { observation }).observation.actor.playerId
  if (firstActor !== solved.players[0]) return 'order mismatch'
  const self: Player = solved.players[0] === observation.actor.playerId ? 0 : 1
  if (tuning.offTree === 'resolve') {
    const found = followWithResolving(
      solved,
      turnStart === -1 ? [] : decisions.slice(turnStart),
      self,
      stats.offTree,
      (next) => cache.put(observation, cacheKey, next),
    )
    if (typeof found === 'string') return found
    if (found.node.kind !== 'action' || found.node.player !== self) return 'off tree'
    return { solved: found.solved, node: found.node, self }
  }
  let node = solved.tree
  for (const decision of turnStart === -1 ? [] : decisions.slice(turnStart)) {
    if (node.kind !== 'action') return 'off tree'
    // Play translates an off-tree size; only the carry demands the exact line.
    const index = node.actions.indexOf(translate(node, decision, solved.spot))
    if (index === -1) return 'off tree'
    node = node.children[index] as RiverNode
  }
  if (node.kind !== 'action' || node.player !== self) return 'off tree'
  return { solved, node, self }
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
  street: StreetSetup,
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
  const known: KnownShares = (decision, taken, player, history) =>
    street.known(decision, taken, player, history, observation.actor.playerId)
  const wantsCarry =
    street.street === 'turn' && (tuning.carry === 'per-turn' || tuning.carry === 'both')
  const safe =
    street.safe && (tuning.safeTurnExploit || wantsCarry || reads === null || reads.trust <= 0)
  const carry =
    safe && wantsCarry ? (street.carry?.(observation, personality, preTurn, players) ?? null) : null
  if (safe && wantsCarry) {
    if (carry === null) stats.carryFallbacks += 1
    else stats.carryUsed += 1
  }
  // A safe re-solve carries the earlier solves' reaches exactly: a move a solver made
  // narrows the range by that solver's own shares, with no doubt mixed in and nothing
  // pruned. Doubt and pruning stay for moves no solver made (v8z's preflop).
  const tableRanges =
    street.street === 'flop' ? tuning.preflop?.ranges(observation, preTurn, players) : null
  const ranges =
    carry?.ranges ??
    tableRanges ??
    trackRanges(
      observation.board,
      preTurn,
      players,
      base,
      personality,
      key,
      street.safe ? 0 : tuning.ranges.minimumWeightShare,
      (decision, taken) =>
        decision.observation.actor.playerId !== players[opponent] ||
        (street.safe && known(decision, taken, personality, preTurn) !== null)
          ? 0
          : cardBlindShare(read, taken, tuning.ranges),
      known,
      street.safe,
    )
  const tracked = performance.now()
  stats.trackMs += tracked - started
  const spot: RiverSpot = {
    board: observation.board,
    pot,
    stack,
    // A safe re-solve keeps every opponent holding, so each gets a promise.
    ranges:
      carry?.ranges ??
      (([0, 1] as const).map((player) =>
        safe && player === opponent && !tableRanges
          ? combosWithFloor(ranges[player], FULL_SUPPORT_SHARE)
          : combosOf(ranges[player]),
      ) as unknown as RiverSpot['ranges']),
    betSizes: tuning.betSizes,
    allIn: true,
    maxRaises: tuning.maxRaises,
  }
  if (spot.ranges[0].length === 0 || spot.ranges[1].length === 0) return 'empty range'
  const model =
    tuning.safeTurnExploit || (safe && wantsCarry) || reads === null || reads.trust <= 0
      ? undefined
      : readsModel(reads, spot, opponent)
  let record: RiverPromiseRecord | undefined
  const diagnostics = street.street === 'flop' ? flopDiagnosticsFromEnvironment() : undefined
  let preparedLeaves: ReturnType<typeof perRiverShowdown> | undefined
  const queryValues = new WeakMap<RiverSolution, readonly [Float64Array, Float64Array]>()
  const solve = (
    target: RiverSpot,
    opponentModel?: RiverOpponentModel,
    gadget?: RiverGadget,
    tree?: RiverNode,
    options: CfrOptions = tuning,
    valuesNeeded = false,
  ) => {
    const solveStarted = performance.now()
    try {
      const perRiver =
        street.street === 'turn' && (tuning.carry === 'per-river' || tuning.carry === 'both')
      const perTurn =
        street.street === 'flop' && (tuning.carry === 'per-turn' || tuning.carry === 'both')
      if (!perRiver && !perTurn) {
        if (tree !== undefined)
          throw new Error('off-tree flop/turn resolving requires per-card carry')
        return street.solve(target, tuning.iterations, network, opponentModel, gadget, tuning)
      }
      const leafNetwork = perRiver ? tuning.riverNetwork : tuning.turnStartNetwork
      if (leafNetwork === undefined)
        throw new Error(
          perRiver
            ? 'per-river carry needs a river network'
            : 'per-turn carry needs a turn-start network',
        )
      record = createRiverPromiseRecord()
      const showdown =
        preparedLeaves === undefined
          ? perRiver
            ? perRiverShowdown(target, leafNetwork, record)
            : perTurnShowdown(
                target,
                leafNetwork,
                record,
                diagnostics?.allInRunouts,
                tuning.turnStartLeaf === undefined
                  ? undefined
                  : {
                      ...tuning.turnStartLeaf,
                      iterations: tuning.iterations,
                    },
              )
          : preparedLeaves.withRecord(record)
      preparedLeaves = showdown
      // Opponent models contain arbitrary strategy closures, which cannot form
      // a complete numeric cache key. Keep those solves outside the memo.
      const memo =
        opponentModel === undefined
          ? memoLbrSolve
          : <T>(_owner: object, _input: unknown, compute: (memoized: boolean) => T) =>
              compute(false)
      const saved = memo(
        perTurn ? (tuning.turnStartLeaf ?? leafNetwork) : leafNetwork,
        [
          street.street,
          target,
          tuning.iterations,
          opponentModel,
          gadget,
          tree,
          options.scheme,
          options.alpha,
          options.beta,
          options.gamma,
          options.fixedStrategies,
          valuesNeeded,
          diagnostics?.allInRunouts,
        ],
        (memoized) => {
          const result = solveRiver(
            target,
            tuning.iterations,
            opponentModel,
            showdown,
            gadget,
            tree,
            options,
          )
          // Showdown is a mutable scratch closure, recreated above in every branch.
          const { showdown: _showdown, ...numeric } = result
          // Root bounds read the solution once more after CFR. On a cache hit,
          // recomputing them would rebuild expensive all-in showdown tables in
          // a fresh scratch closure, despite reusing the strategy itself.
          const values = memoized && valuesNeeded ? riverValues(result).values : undefined
          return { numeric, record, values }
        },
      )
      record = saved.record
      const result = { ...saved.numeric, showdown }
      if (saved.values) queryValues.set(result, saved.values)
      return result
    } finally {
      stats.maxSolveMs = Math.max(stats.maxSolveMs, performance.now() - solveStarted)
    }
  }
  let solution = solve(
    spot,
    model,
    carry?.gadget,
    undefined,
    tuning,
    (safe && carry === null) || (tuning.offTree === 'resolve' && carry === null),
  )
  let rootGadget = carry?.gadget
  if (safe && carry === null) {
    // What each opponent holding is worth against the tracked ranges is its
    // promise; the re-solve then plays without trusting their range at all.
    const promises = (queryValues.get(solution) ?? riverValues(solution).values)[opponent]
    const ranges = [...spot.ranges] as [RiverSpot['ranges'][0], RiverSpot['ranges'][1]]
    ranges[opponent] = ranges[opponent].map((entry) => ({ ...entry, weight: 1 }))
    rootGadget = {
      player: opponent,
      promises,
    }
    solution = solve({ ...spot, ranges }, undefined, rootGadget)
  }
  stats.solveMs += performance.now() - tracked
  stats.solves += 1
  const exploit: SolvedTurn['exploit'] =
    tuning.safeTurnExploit && street.street === 'turn'
      ? {
          attempted: false,
          reference: solution,
          showdown: preparedLeaves?.withRecord() ?? solution.showdown,
          reads,
          posterior: () =>
            combosOf(
              trackRanges(
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
                known,
              )[opponent],
            ),
        }
      : undefined
  const pack = (
    result: RiverSolution,
    state?: OffTreeState<SolvedTurn>,
    gadget = rootGadget,
  ): SolvedTurn => ({
    ...(exploit === undefined ? {} : { exploit: Object.assign(exploit, { reference: result }) }),
    ...(state === undefined ? {} : { offTree: state }),
    spot: tuning.offTree === 'resolve' ? result.spot : spot,
    tree: result.tree,
    strategy: result.strategy,
    hands: [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)],
    players,
    ...(record === undefined ? {} : { record }),
    ...(gadget !== undefined && 'followShare' in result
      ? { gadgetFollow: { player: gadget.player, share: result.followShare as Float64Array } }
      : {}),
  })
  if (tuning.offTree !== 'resolve') return pack(solution)
  // A flop without inherited bounds establishes them once from its blueprint.
  // Subsequent widening must never refresh them at the observed off-tree node.
  const gadget = rootGadget ?? {
    player: opponent,
    promises: (queryValues.get(solution) ?? riverValues(solution).values)[opponent],
  }
  const rootSpot = solution.spot
  const state: OffTreeState<SolvedTurn> = {
    failures: new Map(),
    solve: (tree, fixedStrategies) => {
      const activeGadget = diagnostics?.gadgetOff ? undefined : gadget
      const activeTree = diagnostics?.ipJamOverRaise ? flopIpJamOverRaise(rootSpot, tree) : tree
      return pack(
        solve(rootSpot, undefined, activeGadget, activeTree, { ...tuning, fixedStrategies }),
        state,
        activeGadget,
      )
    },
  }
  return pack(solution, state)
}

/**
 * v9d, lane B's first chained bot: two-player flops solved with the flop-end
 * network, then the turn re-solved safely from the flop solve's ranges (the
 * opponent's flop moves read as the flop's equilibrium plays them, and the turn
 * played from promises rather than trusting that range), then the river told
 * both ranges as the solved streets played them. Preflop is still v6's, and
 * the river still v8z's solver with its reads.
 */
export function solvedFlopPolicy(
  turnNetwork: RiverValueNetwork,
  flopNetwork: RiverValueNetwork,
  overrides: Partial<TurnPolicyTuning> = {},
) {
  let flop: ReturnType<typeof turnSolverPolicy> | undefined
  let turn: ReturnType<typeof turnSolverPolicy> | undefined
  const fromFlop: KnownShares = (decision, taken, personality, history, viewer) => {
    if (flop === undefined || decision.observation.street !== 'flop') return null
    return decision.observation.actor.playerId === viewer
      ? flop.ownShares(decision, taken, personality, true)
      : flop.opponentShares(decision, taken, personality, history, true)
  }
  const river = riverSolverPolicy(
    overrides.preflop?.policy ?? pokerGuardPolicy,
    'river-solver',
    1,
    {
      ...RIVER_CANDIDATE_TUNING,
      ...(overrides.safeExploitV2
        ? { safeExploitV2: true, safeExploitConfig: overrides.safeExploitConfig }
        : {}),
      ...(overrides.boundedReads === undefined ? {} : { boundedReads: overrides.boundedReads }),
      ...(overrides.baselineCaps === undefined ? {} : { baselineCaps: overrides.baselineCaps }),
      ...(overrides.offTree === undefined ? {} : { offTree: overrides.offTree }),
      scheme: overrides.scheme ?? 'cfr+',
      ...(overrides.alpha === undefined ? {} : { alpha: overrides.alpha }),
      ...(overrides.beta === undefined ? {} : { beta: overrides.beta }),
      ...(overrides.gamma === undefined ? {} : { gamma: overrides.gamma }),
      safe: true,
      ...(overrides.carry === 'per-river' || overrides.carry === 'both'
        ? { carry: 'per-river' as const }
        : {}),
    },
    (decision, taken, personality) =>
      turn?.ownShares(decision, taken, personality, true) ??
      flop?.ownShares(decision, taken, personality, true) ??
      null,
    (decision, taken, personality, history) =>
      turn?.opponentShares(decision, taken, personality, history, true) ??
      flop?.opponentShares(decision, taken, personality, history, true) ??
      null,
    (observation, personality, history, players) =>
      turn?.carried(observation, personality, history, players) ?? null,
  )
  turn = turnSolverPolicy(river.policy, turnNetwork, 'turn-solver', 1, overrides, {
    ...TURN_STREET,
    known: fromFlop,
    safe: true,
    carry: (observation, personality, history, players) =>
      flop?.carried(observation, personality, history, players) ?? null,
  })
  flop = turnSolverPolicy(
    turn.policy,
    flopNetwork,
    'flop-solver',
    1,
    overrides.carry === 'per-turn' || overrides.carry === 'both'
      ? {
          ...overrides,
          ...(overrides.flopBetSizes === undefined ? {} : { betSizes: overrides.flopBetSizes }),
        }
      : {
          scheme: overrides.scheme ?? 'cfr+',
          ...(overrides.alpha === undefined ? {} : { alpha: overrides.alpha }),
          ...(overrides.beta === undefined ? {} : { beta: overrides.beta }),
          ...(overrides.gamma === undefined ? {} : { gamma: overrides.gamma }),
        },
    FLOP_STREET,
  )
  return {
    ...flop,
    turn: turn.stats,
    river: river.stats,
    caches: () => ({
      flop: flop?.cacheMemory(),
      turn: turn?.cacheMemory(),
      river: river.cacheMemory(),
    }),
  }
}

/** A hand switches once; no carried promise is consulted after that switch. */
export function predictableHybridPolicy(
  chain: BotPolicy,
  exploit: BotPolicy,
  predictableTrust: number,
) {
  const switched = new HandSolveCache<true>(true, 0)
  const stats = { switches: 0, turn: 0, river: 0 }
  const policy: HandAwareBotPolicy = {
    id: chain.id,
    version: chain.version,
    releaseHand(roomId, handNumber) {
      switched.releaseHand(roomId, handNumber)
      releasePolicyHand(chain, roomId, handNumber)
      releasePolicyHand(exploit, roomId, handNumber)
    },
    decide(context) {
      const { observation } = context
      switched.observe(observation)
      const key = switched.key(observation, 'hybrid')
      const street = observation.street
      if (!switched.has(key) && (street === 'turn' || street === 'river')) {
        const live = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
        const opponentId = live.find(
          (seat) => seat.playerId !== observation.actor.playerId,
        )?.playerId
        const reads =
          live.length === 2 && context.profile.skill === 'og'
            ? riverReads(
                observation.opponentStats?.find((entry) => entry.playerId === opponentId),
                observation.opponents.find((entry) => entry.playerId === opponentId),
                { ...RIVER_POLICY_TUNING, ...RIVER_CANDIDATE_TUNING },
              )
            : null
        if (reads !== null && reads.trust >= predictableTrust) {
          switched.put(observation, key, true)
          stats.switches += 1
          stats[street] += 1
        }
      }
      return (switched.has(key) ? exploit : chain).decide(context)
    },
  }
  return { policy, stats }
}
