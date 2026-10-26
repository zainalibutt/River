import {
  type BotDecision,
  type BotObservationV1,
  type BotOpponentStatsV2,
  type BotOpponentSummaryV1,
  type BotPersonality,
  type BotPolicy,
  type BotPolicyContextV1,
  type Card,
  cardKey,
  DEFAULT_OPPONENT_MODEL_TUNING,
  DEFAULT_OPPONENT_STATS_TUNING,
  handScore,
  makeDeck,
  type PublicBetSize,
  publicBetSize,
  type RateEstimate,
} from '@river/engine'
import { captureCumulativeStrategy } from './bot-aivat.js'
import { aivatSolverState } from './bot-aivat-state.js'
import { type LbrQueryPolicy, policyMoveShares } from './bot-lbr-query.js'
import {
  decisionClass,
  type MoveClass,
  recordedClass,
  updateRange,
  type WeightedHolding,
} from './bot-lbr-range.js'
import {
  followWithResolving,
  type OffTreeState,
  type OffTreeStats,
  offTreeStats,
} from './bot-off-tree.js'
import { type HandAwareBotPolicy, HandSolveCache, releasePolicyHand } from './bot-policy-hand.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { boundedRiverAdaptation, type RiverProposal } from './bot-river-adaptation.js'
import type { RiverCarrySource } from './bot-river-carry.js'
import {
  type CfrOptions,
  comboIndex,
  type Hands,
  prepare,
  type RiverNode,
  type RiverOpponentModel,
  type RiverSolution,
  type RiverSpot,
  riverReport,
  riverStrategyValue,
  riverValues,
  solveRiver,
} from './bot-river-solver.js'
import {
  riverExploitBudget,
  SAFE_EXPLOIT_CONFIG,
  type SafeExploitConfig,
  solveBudgetedStreet,
} from './bot-safe-exploitation.js'
import { solveCacheMemory } from './bot-solver-memory.js'

/**
 * How the river solver is set up. Bets and raises are offered at half the pot
 * and the pot, plus all-in, with one raise after a bet. Holdings that the
 * blueprint almost never plays this way are dropped before solving.
 * `opponentAir` is the share of the opponent's range spread evenly over every
 * holding, for an opponent who did not play the earlier streets as the
 * blueprint would; zero trusts the blueprint completely. `cardBlindPrior` is
 * the chance that any one of the opponent's earlier moves said nothing about
 * their cards, and with `readsWidenRanges` an opponent the reads show betting
 * and raising more than a typical player gets more of that doubt.
 */
export interface RiverPolicyTuning extends CfrOptions {
  readonly safeExploitV2?: boolean
  readonly safeExploitConfig?: Partial<SafeExploitConfig>
  readonly offTree?: 'resolve'
  /**
   * Use the per-holding re-solving gadget (lane B), with reads and added air
   * off. Without `carry`, promises retain the historical refreshed-solve path;
   * that path does not establish safety relative to an earlier street.
   */
  readonly safe?: boolean
  /** Use inherited turn CFVs when an exact recorded turn leaf is available. */
  readonly carry?: 'per-river'
  /** Opt in to read proposals constrained by inherited per-holding BR caps. */
  readonly boundedReads?: boolean
  /** Compare to max(inherited promise, baseline BR), with the same absolute allowance. */
  readonly baselineCaps?: boolean
  readonly betSizes: readonly number[]
  readonly maxRaises: number
  readonly iterations: number
  readonly minimumWeightShare: number
  readonly opponentAir: number
  readonly cardBlindPrior: number
  readonly readsWidenRanges: boolean
  /**
   * The solver steps aside for the base policy when the doubt about an
   * opponent's aggression reaches this, which only extreme reads do; one or
   * more never steps aside.
   */
  readonly extremeReadsToBase: number
  /** The solver steps aside for the base policy when the opponent is all-in. */
  readonly allInToBase: boolean
  /**
   * Exploit what the reads say about how the opponent plays the river: they
   * follow a model built from their statistics with a weight that grows with
   * the evidence, up to `exploitMaxWeight`, reaching half of it after
   * `exploitEvidence` observations. Their shown river aggression gives the
   * model's share of air, starting from `exploitAirPrior` as if
   * `exploitAirPriorWeight` hands had been shown.
   */
  readonly exploitReads: boolean
  readonly exploitMaxWeight: number
  readonly exploitEvidence: number
  readonly exploitAirPrior: number
  readonly exploitAirPriorWeight: number
  /**
   * How quickly reads count. With `readsPriorStrength` above zero the river
   * model's rates are worked out afresh with that many hands' worth of the
   * usual priors, rather than the statistics' own heavier prior; with
   * `readsConfidenceHands` above zero, confidence in the summary read is one
   * minus e to the minus hands seen over that many. Zero keeps the defaults.
   */
  readonly readsPriorStrength: number
  readonly readsConfidenceHands: number
  /**
   * Fold rates by the size of the bet faced: small up to half the pot, medium
   * up to the pot, large beyond it, each drawn towards the overall fold rate
   * as if three bets of that size had been faced. Off, every size gets the
   * overall rate.
   */
  readonly sizeAwareFolds: boolean
  readonly cacheSize: number
}

export const RIVER_POLICY_TUNING: RiverPolicyTuning = {
  betSizes: [0.5, 1],
  maxRaises: 1,
  iterations: 200,
  minimumWeightShare: 0.001,
  opponentAir: 0,
  cardBlindPrior: 0,
  readsWidenRanges: false,
  extremeReadsToBase: 1,
  allInToBase: false,
  exploitReads: false,
  exploitMaxWeight: 0.7,
  exploitEvidence: 20,
  exploitAirPrior: 0.3,
  exploitAirPriorWeight: 3,
  readsPriorStrength: 0,
  readsConfidenceHands: 0,
  sizeAwareFolds: false,
  cacheSize: 64,
}

/**
 * The river candidate under confirmation: a re-raise, a 25% chance that any
 * opponent move ignored the cards, more for aggressive reads, and the reads'
 * river model exploited, with reads that count sooner and fold rates by the
 * size of the bet faced. The table and probe runners call it v8z.
 */
export const RIVER_CANDIDATE_TUNING: Partial<RiverPolicyTuning> = {
  maxRaises: 2,
  cardBlindPrior: 0.25,
  readsWidenRanges: true,
  exploitReads: true,
  exploitEvidence: 8,
  readsPriorStrength: 3,
  readsConfidenceHands: 8,
  sizeAwareFolds: true,
}

/** The first reads candidate, v8x, kept so its records stay reproducible. */
export const RIVER_READS_V8X_TUNING: Partial<RiverPolicyTuning> = {
  maxRaises: 2,
  cardBlindPrior: 0.25,
  readsWidenRanges: true,
  exploitReads: true,
}

/** How many bets of one size count as much as the overall fold rate, for size-aware folds. */
const SIZE_FOLD_STRENGTH = 3

export interface RiverPolicyStats {
  readonly safeExploit: {
    eligible: number
    proposed: number
    accepted: number
    auditFailures: number
    actionTV: number
    modelEVGain: number
    budgetSpent: number
    maxBRIncrease: number
    latencyMs: number
    roots: {
      proposed: boolean
      accepted: boolean
      actionTV: number
      modelEVGain: number
      budget: number
      budgetSpent: number
      maxBRIncrease: number
      auditFailures: number
      latencyMs: number
      modelWeight: number
    }[]
  }
  readonly offTree: OffTreeStats
  /** River decisions the solver answered. */
  solved: number
  /** River decisions left to the base policy, by reason. */
  fallbacks: Record<string, number>
  solves: number
  trackMs: number
  solveMs: number
  /** Summed over solves: what a perfect counter-strategy gains inside the solved spot, as a share of the pot. */
  exploitability: number
  /** Summed over solves: holdings left in the two ranges. */
  combos: number
  carryUsed: number
  carryFallbacks: number
  adaptationChecks: number
  adaptationProposals: number
  adaptations: number
  mixtureWeight: number
  maxCapSlack: number
  maxCapViolation: number
  baselineViolations: number
  baselineHoldingViolations: number
  maxBaselineViolation: number
  adaptationMs: number
}

type Player = 0 | 1

interface SolvedRiver {
  readonly offTree?: OffTreeState<SolvedRiver>
  readonly spot: RiverSpot
  readonly tree: RiverNode
  readonly strategy: ReadonlyMap<string, Float64Array>
  readonly hands: readonly [Hands, Hands]
  /** The two players left, out of position first. */
  readonly players: readonly [string, string]
}

/**
 * The OG with a river solver on top of a base policy. Before the river it
 * plays the base policy, which serves as the blueprint. At a two-player river
 * it rebuilds the hand from the public actions, works out both players' ranges
 * by asking the blueprint how often every holding would have played the hand
 * this way, as if both players followed it, and solves the river for those
 * ranges. It then plays its own holding's share of the solution. A spot is
 * solved once and every later question about it is a lookup, whichever holding
 * it is asked about.
 */
export function riverSolverPolicy(
  base: BotPolicy,
  id: string,
  version: number,
  overrides: Partial<RiverPolicyTuning> = {},
  own: KnownShares = () => null,
  theirs: KnownShares = () => null,
  carry: RiverCarrySource = () => null,
): {
  readonly policy: HandAwareBotPolicy & LbrQueryPolicy
  readonly stats: RiverPolicyStats
  readonly cacheMemory: () => ReturnType<typeof solveCacheMemory>
} {
  const tuning: RiverPolicyTuning = { ...RIVER_POLICY_TUNING, ...overrides }
  const stats: RiverPolicyStats = {
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
    solved: 0,
    fallbacks: {},
    solves: 0,
    trackMs: 0,
    solveMs: 0,
    exploitability: 0,
    combos: 0,
    carryUsed: 0,
    carryFallbacks: 0,
    adaptationChecks: 0,
    adaptationProposals: 0,
    adaptations: 0,
    mixtureWeight: 0,
    maxCapSlack: 0,
    maxCapViolation: 0,
    baselineViolations: 0,
    baselineHoldingViolations: 0,
    maxBaselineViolation: 0,
    adaptationMs: 0,
  }
  const cache = new HandSolveCache<SolvedRiver | string>(
    tuning.safeExploitV2 === true || tuning.boundedReads === true || tuning.offTree === 'resolve',
    tuning.cacheSize,
  )
  const policy: HandAwareBotPolicy & LbrQueryPolicy = {
    id,
    version,
    moveShares(context, taken) {
      if (context.observation.street !== 'river' || context.profile.skill !== 'og') {
        return policyMoveShares(base, context, taken)
      }
      const found = locateRiver(context, base, tuning, cache, stats, own, theirs, carry)
      if (typeof found === 'string') return null
      const { solved, node, self, table } = found
      const hands = solved.hands[self]
      const width = node.actions.length
      const matches = node.actions.map(
        (action) =>
          decisionClass(
            decisionFor(node, action, solved.spot, context.observation),
            context.observation,
          ) === taken,
      )
      return (hole) => {
        const index =
          comboIndex(hands, hole as [Card, Card]) ??
          nearestStrength(hands, hole, context.observation.board)
        let share = 0
        for (let action = 0; action < width; action++) {
          if (matches[action]) share += table[index * width + action] as number
        }
        return share
      }
    },
    releaseHand(roomId, handNumber) {
      cache.releaseHand(roomId, handNumber)
      releasePolicyHand(base, roomId, handNumber)
    },
    decide(context) {
      cache.observe(context.observation)
      const envelope = (decision: BotDecision) => ({
        policyId: id,
        policyVersion: version,
        observationVersion: context.observation.version,
        decision,
        fallbackReason: null,
      })
      const baseline = () => ({ ...base.decide(context), policyId: id, policyVersion: version })
      if (context.observation.street !== 'river' || context.profile.skill !== 'og') {
        return baseline()
      }
      const result = solverDecision(context, base, tuning, cache, stats, own, theirs, carry)
      if (typeof result === 'string') {
        stats.fallbacks[result] = (stats.fallbacks[result] ?? 0) + 1
        return baseline()
      }
      stats.solved += 1
      return envelope(result)
    },
  }
  return { policy, stats, cacheMemory: () => solveCacheMemory(cache) }
}

function solverDecision(
  context: BotPolicyContextV1,
  base: BotPolicy,
  tuning: RiverPolicyTuning,
  cache: HandSolveCache<SolvedRiver | string>,
  stats: RiverPolicyStats,
  own: KnownShares,
  theirs: KnownShares,
  carry: RiverCarrySource,
): BotDecision | string {
  const found = locateRiver(context, base, tuning, cache, stats, own, theirs, carry)
  if (typeof found === 'string') return found
  const { solved, node, self, table } = found
  const { observation } = context
  const hole = observation.actor.hole
  const hands = solved.hands[self]
  const index =
    comboIndex(hands, hole as [Card, Card]) ?? nearestStrength(hands, hole, observation.board)
  const width = node.actions.length
  const row = table.subarray(index * width, (index + 1) * width)
  captureCumulativeStrategy(
    context.rng,
    row,
    (index) => decisionFor(node, node.actions[index] as string, solved.spot, observation),
    1,
    () => aivatSolverState(solved.spot, solved.tree, solved.strategy, node, self),
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

function locateRiver(
  context: BotPolicyContextV1,
  base: BotPolicy,
  tuning: RiverPolicyTuning,
  cache: HandSolveCache<SolvedRiver | string>,
  stats: RiverPolicyStats,
  own: KnownShares,
  theirs: KnownShares,
  carry: RiverCarrySource,
):
  | {
      solved: SolvedRiver
      node: Extract<RiverNode, { kind: 'action' }>
      self: 0 | 1
      table: Float64Array
    }
  | string {
  const { observation, personality } = context
  const live = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
  if (live.length !== 2) return 'not heads-up'
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
  const riverStart = decisions.findIndex((decision) => decision.taken.street === 'river')
  const preRiver = riverStart === -1 ? decisions : decisions.slice(0, riverStart)
  const key = [
    personality.id,
    observation.tilt.factor,
    observation.dealerSeat,
    observation.board.map(cardKey).join(','),
    observation.seats.map((seat) => `${seat.seat}:${seat.playerId}:${seat.stack + seat.betHand}`),
    JSON.stringify(preRiver.map((decision) => decision.taken)),
  ].join('|')
  // The opponent's range depends on whose view it is, and on the reads, so the cache does too.
  const opponentId = live.find((seat) => seat.playerId !== observation.actor.playerId)?.playerId
  const read = observation.opponents.find((summary) => summary.playerId === opponentId)
  const doubt = cardBlindShare(read, 'aggressive', tuning)
  const reads =
    tuning.exploitReads || tuning.boundedReads || tuning.safeExploitV2
      ? riverReads(
          observation.opponentStats?.find((entry) => entry.playerId === opponentId),
          read,
          tuning,
        )
      : null
  const cacheKey =
    tuning.safeExploitV2 || tuning.boundedReads || tuning.offTree === 'resolve'
      ? cache.key(observation, `${observation.actor.playerId}|${observation.board.map(cardKey)}`)
      : `${key}|${observation.actor.playerId}${doubt > 0 ? `|${doubt.toFixed(4)}` : ''}${
          reads === null ? '' : `|${Object.values(reads).map((value) => value.toFixed(4))}`
        }`
  let solved = cache.get(cacheKey)
  // Once chosen, even new reads that would otherwise trigger a fallback do
  // not change this river's policy. The flag-off path retains its old guards.
  if ((!tuning.safeExploitV2 && !tuning.boundedReads) || solved === undefined) {
    if (tuning.extremeReadsToBase < 1 && doubt >= tuning.extremeReadsToBase) return 'extreme reads'
    if (tuning.allInToBase && live.some((seat) => seat.playerId === opponentId && seat.allIn)) {
      return 'facing all-in'
    }
  }
  if (solved === undefined) {
    solved = solveSpot(
      observation,
      preRiver,
      live,
      base,
      personality,
      key,
      tuning,
      stats,
      reads,
      own,
      theirs,
      carry,
    )
    cache.put(observation, cacheKey, solved)
  }
  if (typeof solved === 'string') return solved
  const firstActor = (decisions[riverStart] ?? { observation }).observation.actor.playerId
  if (firstActor !== solved.players[0]) return 'order mismatch'
  const self: Player = solved.players[0] === observation.actor.playerId ? 0 : 1
  let node = solved.tree
  if (tuning.offTree === 'resolve') {
    const found = followWithResolving(
      solved,
      riverStart === -1 ? [] : decisions.slice(riverStart),
      self,
      stats.offTree,
      (next) => cache.put(observation, cacheKey, next),
    )
    if (typeof found === 'string') return found
    solved = found.solved
    node = found.node
  } else
    for (const decision of riverStart === -1 ? [] : decisions.slice(riverStart)) {
      if (node.kind !== 'action') return 'off tree'
      const index = node.actions.indexOf(translate(node, decision, solved.spot))
      if (index === -1) return 'off tree'
      node = node.children[index] as RiverNode
    }
  if (node.kind !== 'action' || node.player !== self) return 'off tree'
  const table = solved.strategy.get(node.history)
  const hole = observation.actor.hole
  if (table === undefined || hole.length !== 2) return 'no strategy'
  return { solved, node, self, table }
}

function solveSpot(
  observation: BotObservationV1,
  preRiver: readonly PublicDecision[],
  live: BotObservationV1['seats'],
  base: BotPolicy,
  personality: BotPersonality,
  key: string,
  tuning: RiverPolicyTuning,
  stats: RiverPolicyStats,
  reads: RiverReads | null = null,
  own: KnownShares = () => null,
  theirs: KnownShares = () => null,
  carrySource: RiverCarrySource = () => null,
): SolvedRiver | string {
  const stacks = live.map((seat) => seat.stack + seat.betStreet)
  const stack = Math.min(...stacks)
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
  const safe = tuning.safe === true || tuning.carry === 'per-river'
  const carry =
    tuning.carry === 'per-river' && safe
      ? carrySource(observation, personality, preRiver, players)
      : null
  if (tuning.carry === 'per-river') {
    if (carry === null) stats.carryFallbacks += 1
    else stats.carryUsed += 1
  }
  const known: KnownShares = (decision, taken, player, history) =>
    decision.observation.actor.playerId === observation.actor.playerId
      ? own(decision, taken, player, history)
      : theirs(decision, taken, player, history)
  const ranges =
    carry === null
      ? trackRanges(
          observation.board,
          preRiver,
          players,
          base,
          personality,
          key,
          safe ? 0 : tuning.minimumWeightShare,
          (decision, taken) =>
            decision.observation.actor.playerId !== players[opponent] ||
            (safe && known(decision, taken, personality, preRiver) !== null)
              ? 0
              : cardBlindShare(read, taken, tuning),
          known,
          safe,
        )
      : ([[], []] as [WeightedHolding[], WeightedHolding[]])
  if (!safe) ranges[opponent] = withAir(ranges[opponent], tuning.opponentAir)
  const tracked = performance.now()
  stats.trackMs += tracked - started
  const spot: RiverSpot = {
    board: observation.board,
    pot,
    stack,
    ranges:
      carry?.ranges ??
      (([0, 1] as const).map((player) =>
        safe && player === opponent
          ? combosWithFloor(ranges[player], FULL_SUPPORT_SHARE)
          : combosOf(ranges[player]),
      ) as unknown as RiverSpot['ranges']),
    betSizes: tuning.betSizes,
    allIn: true,
    maxRaises: tuning.maxRaises,
  }
  if (spot.ranges[0].length === 0 || spot.ranges[1].length === 0) return 'empty range'
  const model =
    safe || reads === null || reads.trust <= 0 ? undefined : readsModel(reads, spot, opponent)
  const guessed =
    carry === null
      ? solveRiver(spot, tuning.iterations, model, undefined, undefined, undefined, tuning)
      : undefined
  let solution =
    guessed ??
    solveRiver(spot, tuning.iterations, undefined, undefined, carry?.gadget, undefined, tuning)
  let rootGadget = carry?.gadget
  if (safe && guessed !== undefined) {
    // Historical fallback: refreshed values, not inherited earlier-street bounds.
    // Preserve this path for existing policies and count opt-in carry misses.
    const promises = riverValues(guessed).values[opponent]
    const flat = [...spot.ranges] as [RiverSpot['ranges'][0], RiverSpot['ranges'][1]]
    flat[opponent] = flat[opponent].map((entry) => ({ ...entry, weight: 1 }))
    rootGadget = { player: opponent, promises }
    solution = solveRiver(
      { ...spot, ranges: flat },
      tuning.iterations,
      undefined,
      undefined,
      rootGadget,
      undefined,
      tuning,
    )
  }
  if (tuning.safeExploitV2) {
    const started = performance.now()
    const config = { ...SAFE_EXPLOIT_CONFIG, ...tuning.safeExploitConfig }
    // Blind posts are the hand contribution not accounted for by actions.
    // A short blind underestimates the nominal stake, which is conservative.
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
    const budget = riverExploitBudget(pot, bigBlind, config)
    const counters = stats.safeExploit
    counters.eligible++
    let chosen: ReturnType<typeof solveBudgetedStreet> | undefined
    if (reads !== null && reads.trust > 0) {
      const posterior = trackRanges(
        observation.board,
        preRiver,
        players,
        base,
        personality,
        key,
        tuning.minimumWeightShare,
        (decision, taken) =>
          decision.observation.actor.playerId === players[opponent]
            ? cardBlindShare(read, taken, tuning)
            : 0,
        known,
      )[opponent]
      chosen = solveBudgetedStreet(
        solution,
        readsModel(reads, solution.spot, opponent),
        combosOf(posterior),
        budget,
        config,
      )
      solution = chosen.solution
    }
    const root = {
      proposed: chosen?.proposed ?? false,
      accepted: (chosen?.weight ?? 0) > 0,
      actionTV: chosen?.actionTV ?? 0,
      modelEVGain: chosen?.modelEVGain ?? 0,
      budget,
      budgetSpent: chosen?.maxBRIncrease ?? 0,
      maxBRIncrease: chosen?.maxBRIncrease ?? 0,
      auditFailures: chosen?.auditFailures ?? 0,
      latencyMs: performance.now() - started,
      modelWeight: chosen?.modelWeight ?? 0,
    }
    counters.proposed += Number(root.proposed)
    counters.accepted += Number(root.accepted)
    counters.actionTV += root.actionTV
    counters.modelEVGain += root.modelEVGain
    counters.budgetSpent += root.budgetSpent
    counters.maxBRIncrease = Math.max(counters.maxBRIncrease, root.maxBRIncrease)
    counters.auditFailures += root.auditFailures
    counters.latencyMs += root.latencyMs
    counters.roots.push(root)
  } else if (tuning.boundedReads && carry !== null) {
    const adaptationStarted = performance.now()
    const chosen = boundedRiverAdaptation(
      solution,
      carry.gadget,
      () => {
        if (reads === null || reads.trust <= 0) return null
        // A model posterior is rebuilt separately. Carry's positive support
        // placeholders must never become posterior evidence for the reads model.
        const posterior = trackRanges(
          observation.board,
          preRiver,
          players,
          base,
          personality,
          key,
          tuning.minimumWeightShare,
          (decision, taken) =>
            decision.observation.actor.playerId === players[opponent]
              ? cardBlindShare(read, taken, tuning)
              : 0,
          known,
        )[opponent]
        return readBasedRiverProposal(solution, combosOf(posterior), reads, opponent, tuning)
      },
      tuning.baselineCaps,
    )
    stats.adaptationChecks++
    stats.adaptationProposals += Number(chosen.proposed)
    stats.adaptations += Number(chosen.weight > 0)
    stats.mixtureWeight += chosen.weight
    stats.maxCapSlack = Math.max(stats.maxCapSlack, chosen.cap.maxSlack)
    stats.maxCapViolation = Math.max(stats.maxCapViolation, chosen.cap.maxViolation)
    stats.baselineViolations += Number(chosen.baseline.violations > 0)
    stats.baselineHoldingViolations += chosen.baseline.violations
    stats.maxBaselineViolation = Math.max(stats.maxBaselineViolation, chosen.baseline.maxViolation)
    stats.adaptationMs += performance.now() - adaptationStarted
    solution = chosen.solution
  }
  stats.solveMs += performance.now() - tracked
  stats.solves += 1
  stats.exploitability += riverReport(guessed ?? solution).exploitability
  stats.combos += spot.ranges[0].length + spot.ranges[1].length
  const pack = (result: RiverSolution, state?: OffTreeState<SolvedRiver>): SolvedRiver => ({
    ...(state === undefined ? {} : { offTree: state }),
    spot: tuning.offTree === 'resolve' ? result.spot : spot,
    tree: result.tree,
    strategy: result.strategy,
    hands: [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)],
    players,
  })
  if (tuning.offTree !== 'resolve') return pack(solution)
  const gadget = rootGadget ?? {
    player: opponent,
    promises: riverValues(solution).values[opponent],
  }
  const rootSpot = solution.spot
  const state: OffTreeState<SolvedRiver> = {
    failures: new Map(),
    solve: (tree, fixedStrategies) =>
      pack(
        solveRiver(rootSpot, tuning.iterations, undefined, undefined, gadget, tree, {
          ...tuning,
          fixedStrategies,
        }),
        state,
      ),
  }
  return pack(solution, state)
}

/** Build the v8z restricted Nash proposal and a FIXED model objective. */
export function readBasedRiverProposal(
  baseline: RiverSolution,
  posterior: RiverSpot['ranges'][0],
  reads: RiverReads,
  opponent: Player,
  tuning: RiverPolicyTuning,
): RiverProposal | null {
  if (!posterior.some((h) => h.weight > 0)) return null
  const ranges = [...baseline.spot.ranges] as [RiverSpot['ranges'][0], RiverSpot['ranges'][1]]
  ranges[opponent] = posterior
  const spot = { ...baseline.spot, ranges }
  const model = readsModel(reads, spot, opponent)
  const proposed = solveRiver(
    spot,
    tuning.iterations,
    model,
    undefined,
    undefined,
    baseline.tree,
    tuning,
  )
  const fixed = new Map<string, Float64Array>()
  const hands = prepare(posterior, spot.board)
  const install = (node: RiverNode) => {
    if (node.kind !== 'action') return
    if (node.player === opponent) fixed.set(node.history, model.strategy(node, hands))
    node.children.forEach(install)
  }
  install(baseline.tree)
  return {
    solution: proposed,
    value: (solution) => {
      const strategy = new Map(solution.strategy)
      for (const [history, table] of fixed) strategy.set(history, table)
      return riverStrategyValue({ ...solution, spot, strategy }, opponent === 0 ? 1 : 0)
    },
  }
}

/**
 * For a past move chosen by a policy other than the blueprint, the share of
 * each holding that makes it, as that policy's own strategy says; null where
 * the blueprint made the move.
 */
export type KnownShares = (
  decision: PublicDecision,
  taken: MoveClass,
  personality: BotPersonality,
  /** The hand's public decisions up to the river, the one asked about among them. */
  history: readonly PublicDecision[],
  /** The player whose view the ranges are tracked for, when the caller knows it. */
  viewer?: string,
) => ((hole: readonly [Card, Card]) => number) | null

/**
 * Both players' ranges at the start of the river, as the blueprint would have
 * played the hand. Every holding starts equal; each earlier move multiplies a
 * holding's weight by how often the blueprint makes that move with it, or by
 * the exact share `known` gives for a move another policy chose.
 */
export function trackRanges(
  board: readonly Card[],
  preRiver: readonly PublicDecision[],
  players: readonly [string, string],
  blueprint: BotPolicy,
  personality: BotPersonality,
  seed: string,
  minimumWeightShare = RIVER_POLICY_TUNING.minimumWeightShare,
  doubt: (decision: PublicDecision, taken: MoveClass) => number = () => 0,
  known: KnownShares = () => null,
  /** Apply known shares exactly, unsmoothed, as a safe re-solve carries a solver's reaches. */
  exact = false,
): [WeightedHolding[], WeightedHolding[]] {
  const blocked = new Set(board.map(cardKey))
  const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const fresh = () => {
    const holdings: WeightedHolding[] = []
    for (let first = 0; first < deck.length; first += 1) {
      for (let second = first + 1; second < deck.length; second += 1) {
        holdings.push({ hole: [deck[first] as Card, deck[second] as Card], weight: 1 })
      }
    }
    return holdings
  }
  const ranges: [WeightedHolding[], WeightedHolding[]] = [fresh(), fresh()]
  preRiver.forEach((decision, index) => {
    const player = players.indexOf(decision.observation.actor.playerId)
    if (player === -1) return
    const range = ranges[player] as WeightedHolding[]
    const taken = recordedClass(decision.taken, decision.observation)
    updateRange(
      range,
      blueprint,
      personality,
      decision.observation,
      taken,
      `${seed}:${index}`,
      doubt(decision, taken),
      known(decision, taken, personality, preRiver) ?? undefined,
      exact,
    )
    const heaviest = range.reduce((most, holding) => Math.max(most, holding.weight), 0)
    for (const holding of range) {
      if (holding.weight < heaviest * minimumWeightShare) holding.weight = 0
    }
  })
  return ranges
}

/**
 * How likely it is that one of the opponent's moves said nothing about their
 * cards. Every opponent gets the prior. With reads on, an opponent who bets and
 * raises more than a typical player gets more for those moves, in proportion to
 * how far above typical they are and how sure the read is: a player who raises
 * every hand approaches one, and their range stays wide however hard they bet.
 */
export function cardBlindShare(
  read: BotOpponentSummaryV1 | undefined,
  taken: MoveClass,
  tuning: RiverPolicyTuning,
): number {
  const prior = tuning.cardBlindPrior
  if (!tuning.readsWidenRanges || read === undefined || taken !== 'aggressive') return prior
  const typical = DEFAULT_OPPONENT_MODEL_TUNING.priorAggression
  const excess = Math.max(0, (read.aggressionFrequency - typical) / (1 - typical))
  const confidence =
    tuning.readsConfidenceHands > 0
      ? 1 - Math.exp(-read.sampleCount / tuning.readsConfidenceHands)
      : read.confidence
  return Math.min(1, Math.max(prior, confidence * excess))
}

/** What the reads say about how an opponent plays the river, and how far to trust it. */
export interface RiverReads {
  /** How often they bet when checked to on the river. */
  readonly bet: number
  /** How often they fold, and how often they raise, when bet into. */
  readonly fold: number
  readonly raise: number
  /** How often they fold to a small, a medium and a large bet. */
  readonly foldSmall: number
  readonly foldMedium: number
  readonly foldLarge: number
  /** The share of the river aggression they showed down that was air. */
  readonly air: number
  /** Their usual bet or raise as a share of the pot. */
  readonly size: number
  /** The weight the solver gives to their following these numbers. */
  readonly trust: number
}

/** The river reads for one opponent, or none when there are no statistics for them. */
export function riverReads(
  stats: BotOpponentStatsV2 | undefined,
  read: BotOpponentSummaryV1 | undefined,
  tuning: RiverPolicyTuning,
): RiverReads | null {
  if (stats === undefined) return null
  const shown = stats.shownRiverAggression
  const shownHands = shown.air + shown.pair + shown.made
  const evidence =
    stats.riverBetWhenCheckedTo.opportunities + stats.foldToBet.opportunities + shownHands
  const { priors } = DEFAULT_OPPONENT_STATS_TUNING
  const strength = tuning.readsPriorStrength
  const rate = (estimate: RateEstimate, prior: number) =>
    Math.min(
      1,
      Math.max(
        0,
        strength > 0
          ? (estimate.successes + prior * strength) / (estimate.opportunities + strength)
          : estimate.mean,
      ),
    )
  const fold = rate(stats.foldToBet, priors.foldToBet)
  const foldTo = (size: PublicBetSize) => {
    if (!tuning.sizeAwareFolds) return fold
    const faced = stats.foldToBetBySize[size]
    return (
      (faced.successes + fold * SIZE_FOLD_STRENGTH) / (faced.opportunities + SIZE_FOLD_STRENGTH)
    )
  }
  return {
    bet: rate(stats.riverBetWhenCheckedTo, priors.riverBetWhenCheckedTo),
    fold,
    raise: Math.min(1 - fold, rate(stats.raiseVsBet, priors.raiseVsBet)),
    foldSmall: foldTo('small'),
    foldMedium: foldTo('medium'),
    foldLarge: foldTo('large'),
    air:
      (shown.air + tuning.exploitAirPrior * tuning.exploitAirPriorWeight) /
      (shownHands + tuning.exploitAirPriorWeight),
    size: read?.averageAggressivePotRatio ?? DEFAULT_OPPONENT_MODEL_TUNING.priorAggressivePotRatio,
    trust: (tuning.exploitMaxWeight * evidence) / (evidence + tuning.exploitEvidence),
  }
}

/**
 * The reads as a strategy the solver can exploit. When checked to, the
 * opponent bets their usual size with their strongest hands and, in the
 * share their showdowns suggest, their weakest. When bet into, they raise the
 * same way, fold their weakest hands and call with the rest, at the rates
 * the reads give.
 */
export function readsModel(reads: RiverReads, spot: RiverSpot, player: 0 | 1): RiverOpponentModel {
  return {
    player,
    weight: reads.trust,
    strategy: (node, hands) => {
      const width = node.actions.length
      const count = hands.combos.length
      const probabilities = new Float64Array(count * width)
      const total = hands.weights.reduce((sum, weight) => sum + weight, 0)
      const used = new Float64Array(count)
      const assign = (mass: number, strongest: boolean): Float64Array => {
        const share = new Float64Array(count)
        let left = mass
        for (let step = 0; step < count && left > 1e-12; step += 1) {
          const h = hands.order[strongest ? count - 1 - step : step] as number
          const weight = hands.weights[h] as number
          const free = 1 - (used[h] as number)
          if (weight <= 0 || free <= 0) continue
          const taken = Math.min(free, left / weight)
          share[h] = taken
          used[h] = (used[h] as number) + taken
          left -= taken * weight
        }
        return share
      }
      const aggressive = nearestSize(node, spot, reads.size)
      const facing = node.actions[0] === 'f'
      const fold = facing ? foldFacing(node, spot, reads) : 0
      const rate = facing ? Math.min(reads.raise, 1 - fold) : reads.bet
      const top =
        aggressive === -1 ? new Float64Array(count) : assign((1 - reads.air) * rate * total, true)
      const bottom =
        aggressive === -1 ? new Float64Array(count) : assign(reads.air * rate * total, false)
      const folds = facing ? assign(fold * total, false) : new Float64Array(count)
      for (let h = 0; h < count; h += 1) {
        const raised = (top[h] as number) + (bottom[h] as number)
        const folded = folds[h] as number
        if (aggressive !== -1) probabilities[h * width + aggressive] = raised
        if (facing) {
          probabilities[h * width] = folded
          probabilities[h * width + 1] = 1 - raised - folded
        } else {
          probabilities[h * width] = 1 - raised
        }
      }
      return probabilities
    },
  }
}

/** How much the modelled player folds to the bet they face at a decision, by its size. */
function foldFacing(
  node: Extract<RiverNode, { kind: 'action' }>,
  spot: RiverSpot,
  reads: RiverReads,
): number {
  const mine = node.paid[node.player]
  const theirs = node.paid[node.player === 0 ? 1 : 0]
  const toCall = theirs - mine
  const before = spot.pot + node.paid[0] + node.paid[1] - toCall
  const size = publicBetSize(toCall, before)
  if (size === 'small') return reads.foldSmall
  if (size === 'medium') return reads.foldMedium
  if (size === 'large') return reads.foldLarge
  return reads.fold
}

/** The bet or raise at a decision whose share of the pot is nearest `size`, or -1 when there is none. */
function nearestSize(
  node: Extract<RiverNode, { kind: 'action' }>,
  spot: RiverSpot,
  size: number,
): number {
  let best = -1
  let distance = Number.POSITIVE_INFINITY
  node.actions.forEach((label, index) => {
    const offered = betShare(node, label, spot)
    if (offered === null) return
    const gap = Math.abs(Math.log(Math.max(0.01, size)) - Math.log(offered))
    if (gap < distance) {
      distance = gap
      best = index
    }
  })
  return best
}

/**
 * A range with `share` of its weight spread evenly over every holding, keeping
 * its total. Holdings the blueprint ruled out come back at that even weight.
 */
export function withAir(range: readonly WeightedHolding[], share: number): WeightedHolding[] {
  if (share <= 0) return [...range]
  const total = range.reduce((sum, holding) => sum + holding.weight, 0)
  const even = (share * total) / Math.max(1, range.length)
  return range.map((holding) => ({
    hole: holding.hole,
    weight: (1 - share) * holding.weight + even,
  }))
}

export function combosOf(range: readonly WeightedHolding[]) {
  return range
    .filter((holding) => holding.weight > 0)
    .map((holding) => ({ hole: holding.hole as [Card, Card], weight: holding.weight }))
}

/**
 * Every holding of a tracked range, none left out: a holding the tracking
 * pruned to nothing keeps `share` of the heaviest holding's weight. A safe
 * re-solve gives each opponent holding a promise, and only a holding in the
 * solve can have one, so the opponent can't bring a hand the guess ruled out.
 */
/** In a safe re-solve, a holding the tracking pruned keeps this share of the heaviest weight. */
export const FULL_SUPPORT_SHARE = 1e-4

export function combosWithFloor(range: readonly WeightedHolding[], share: number) {
  const heaviest = range.reduce((most, holding) => Math.max(most, holding.weight), 0)
  const floor = heaviest * share
  return range
    .filter((holding) => heaviest > 0 && holding.weight >= 0)
    .map((holding) => ({
      hole: holding.hole as [Card, Card],
      weight: Math.max(holding.weight, floor),
    }))
}

/**
 * The solver's action for a move made at the table. A bet or raise maps to
 * the offered size nearest to it as a share of the pot, and an all-in to
 * all-in; an all-in that only matches the bet is a call.
 */
export function translate(
  node: Extract<RiverNode, { kind: 'action' }>,
  decision: PublicDecision,
  spot: RiverSpot,
): string {
  const { action } = decision.taken
  const view = decision.observation
  if (action.kind === 'check') return 'k'
  if (action.kind === 'fold') return 'f'
  if (action.kind === 'call') return 'c'
  const total = action.kind === 'allIn' ? view.actor.stack + view.actor.betStreet : action.to
  if (total <= view.currentBet) return 'c'
  if (action.kind === 'allIn' && node.actions.includes('a')) return 'a'
  const share = (total - view.currentBet) / Math.max(1, view.pot + view.amountToCall)
  let best = ''
  let distance = Number.POSITIVE_INFINITY
  node.actions.forEach((label) => {
    const offered = betShare(node, label, spot)
    if (offered === null) return
    const gap = Math.abs(Math.log(share) - Math.log(offered))
    if (gap < distance) {
      distance = gap
      best = label
    }
  })
  return best
}

/** The share of the pot a solver bet or raise adds beyond calling, or null for other actions. */
function betShare(
  node: Extract<RiverNode, { kind: 'action' }>,
  label: string,
  spot: RiverSpot,
): number | null {
  const mine = node.paid[node.player]
  const theirs = node.paid[node.player === 0 ? 1 : 0]
  let total: number
  if (label === 'a') total = spot.stack
  else if (label.startsWith('b')) total = Number(label.slice(1))
  else return null
  const potAfterCall = spot.pot + node.paid[0] + node.paid[1] + (theirs - mine)
  return (total - theirs) / potAfterCall
}

/** The solver's action as a move at the real table, sized as the same share of the real pot. */
export function decisionFor(
  node: Extract<RiverNode, { kind: 'action' }>,
  label: string,
  spot: RiverSpot,
  observation: BotObservationV1,
): BotDecision {
  const { legal, amountToCall, currentBet, pot } = observation
  const passive: BotDecision = amountToCall > 0 ? { kind: 'call' } : { kind: 'check' }
  if (label === 'f') return legal.check ? { kind: 'check' } : { kind: 'fold' }
  if (label === 'k' || label === 'c') return passive
  if (label === 'a') return legal.allIn.enabled ? { kind: 'allIn' } : passive
  const share = betShare(node, label, spot) as number
  const to = Math.round(currentBet + share * (pot + amountToCall))
  if (!legal.raiseTo.enabled) return legal.allIn.enabled ? { kind: 'allIn' } : passive
  if (to >= legal.raiseTo.max) return { kind: 'allIn' }
  return { kind: 'raiseTo', to: Math.max(legal.raiseTo.min, to) }
}

/** The holding in a prepared range whose river hand is closest in strength to `hole`'s. */
export function nearestStrength(
  hands: Hands,
  hole: readonly Card[],
  board: readonly Card[],
): number {
  const score = handScore([...hole, ...board])
  let best = 0
  let gap = Number.POSITIVE_INFINITY
  hands.strength.forEach((strength, index) => {
    const distance = Math.abs(strength - score)
    if (distance < gap) {
      gap = distance
      best = index
    }
  })
  return best
}
