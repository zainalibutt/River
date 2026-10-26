import { readFileSync } from 'node:fs'
import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  type Card,
  cardKey,
  makeDeck,
  mulberry32,
  seedFromString,
} from '@river/engine'
import { captureCumulativeStrategy } from './bot-aivat.js'
import type { WeightedHolding } from './bot-lbr-range.js'
import { type HandAwareBotPolicy, HandSolveCache, releasePolicyHand } from './bot-policy-hand.js'
import type { PreflopAction, PreflopNode } from './bot-preflop-solve-tree.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'

type DecisionNode = Extract<PreflopNode, { kind: 'decision' }>
export interface PreflopPack {
  readonly metadata: { readonly effectiveStackBb: number; readonly tree: PreflopNode }
  readonly nodes: readonly {
    readonly id: string
    readonly classes: readonly { readonly hand: string; readonly frequencies: readonly number[] }[]
  }[]
}
export interface TablePreflopSource {
  readonly policy: HandAwareBotPolicy
  readonly stats: PreflopTableStats
  ranges(
    observation: BotObservationV1,
    history: readonly PublicDecision[],
    players: readonly [string, string],
  ): [WeightedHolding[], WeightedHolding[]] | null
}
export interface PreflopTableStats {
  decisions: number
  preflopOffTree: number
  fallbacks: Record<string, number>
  rangeFallbacks: number
  exactRanges: number
  packs: Record<number, number>
  clampedBelow: number
  clampedAbove: number
}

const packs = new Map<string, PreflopPack>()
/** Add exported depths here (or inject packs into tablePreflopPolicy). Ties choose shallower. */
export const PREFLOP_DEPTHS = [100, 200] as const
export type PreflopPackVersion = 'v2' | 'v3' | 'v4'

/** The pack v9gp plays: v3 unless an experiment sets RIVER_PREFLOP_PACK (v2, v3 or v4). */
export function defaultPreflopPackVersion(
  text = process.env.RIVER_PREFLOP_PACK,
): PreflopPackVersion {
  if (text === undefined || text === '') return 'v3'
  if (text === 'v2' || text === 'v3' || text === 'v4') return text
  throw new Error('RIVER_PREFLOP_PACK must be v2, v3 or v4')
}

export function loadPreflopPack(
  depth: number,
  version: PreflopPackVersion = defaultPreflopPackVersion(),
): PreflopPack {
  const key = `${version}:${depth}`
  let pack = packs.get(key)
  if (!pack) {
    pack = JSON.parse(
      readFileSync(new URL(`../preflop/${version}/${depth}bb.json`, import.meta.url), 'utf8'),
    ) as PreflopPack
    packs.set(key, pack)
  }
  return pack
}
export function selectPreflopDepth(effective: number, depths: readonly number[] = PREFLOP_DEPTHS) {
  if (!Number.isFinite(effective) || effective <= 0 || depths.length === 0)
    throw new Error('invalid preflop depth')
  const sorted = [...depths].sort((a, b) => a - b)
  const depth = sorted.reduce((best, d) =>
    Math.abs(d - effective) < Math.abs(best - effective) ? d : best,
  )
  return {
    depth,
    clamp:
      effective < (sorted[0] as number)
        ? 'below'
        : effective > (sorted.at(-1) as number)
          ? 'above'
          : null,
  }
}

export function preflopClass(hole: readonly Card[]): string {
  const ranks = '23456789TJQKA'
  const [a, b] = [...hole].sort((x, y) => ranks.indexOf(y.rank) - ranks.indexOf(x.rank))
  if (!a || !b) throw new Error('preflop needs two cards')
  return `${a.rank}${b.rank}${a.rank === b.rank ? '' : a.suit === b.suit ? 's' : 'o'}`
}
export function tableRow(pack: PreflopPack, node: DecisionNode, hole: readonly Card[]) {
  const hand = preflopClass(hole)
  const row = pack.nodes.find((n) => n.id === node.id)?.classes.find((h) => h.hand === hand)
  if (!row) throw new Error(`missing preflop row ${node.id}`)
  return row.frequencies
}
export function samplePreflopAction(probabilities: readonly number[], rng: () => number): number {
  let draw = rng() * probabilities.reduce((a, b) => a + b, 0)
  for (let k = 0; k < probabilities.length; k++) {
    draw -= probabilities[k] as number
    if (draw < 0) return k
  }
  return probabilities.length - 1
}

/** Ganzfried/Sandholm: P(translate x to A), with A,x,B measured in pot shares.
 * https://www.sigecom.org/exchanges/volume_14/2/GANZFRIED.pdf section 2.2.
 */
export function pseudoHarmonicLower(a: number, x: number, b: number): number {
  if (x <= a) return 1
  if (x >= b) return 0
  return ((b - x) * (1 + a)) / ((b - a) * (1 + x))
}

/** Table targets are total contributions; legal min-raises and effective all-ins win. */
export function preflopLiveAction(
  action: PreflopAction,
  observation: BotObservationV1,
  bb: number,
): BotDecision {
  const { legal } = observation
  const passive = (): BotDecision =>
    legal.check ? { kind: 'check' } : legal.call.enabled ? { kind: 'call' } : { kind: 'fold' }
  if (action.kind === 'fold') return legal.fold ? { kind: 'fold' } : passive()
  if (action.kind === 'call' || action.kind === 'limp' || action.kind === 'check') return passive()
  const ownMax = observation.actor.stack + observation.actor.betStreet
  const otherMax = Math.max(
    ...observation.seats
      .filter((s) => s.playerId !== null && s.playerId !== observation.actor.playerId && !s.folded)
      .map((s) => s.stack + s.betStreet),
  )
  const cap = Math.min(ownMax, otherMax)
  if (cap <= observation.currentBet) return passive()
  const target = action.kind === 'jam' ? cap : Math.min(cap, Math.round(action.to * bb))
  if (legal.raiseTo.enabled) {
    // When only the opponent is shorter than a full min-raise, raise to the
    // legal minimum. The unmatched excess is returned by the live engine.
    const to = Math.min(legal.raiseTo.max, Math.max(legal.raiseTo.min, target))
    return to === ownMax && legal.allIn.enabled ? { kind: 'allIn' } : { kind: 'raiseTo', to }
  }
  return legal.allIn.enabled && ownMax <= cap ? { kind: 'allIn' } : passive()
}

function targetOf(action: BotDecision, observation: BotObservationV1): number | null {
  const to =
    action.kind === 'raiseTo'
      ? action.to
      : action.kind === 'allIn'
        ? observation.actor.stack + observation.actor.betStreet
        : null
  if (to === null) return null
  // Uncalled excess in an opponent's larger all-in is not a new table size.
  const opponents = observation.seats.filter(
    (s) => s.playerId !== null && s.playerId !== observation.actor.playerId && !s.folded,
  )
  return Math.min(to, ...opponents.map((s) => s.stack + s.betStreet))
}
function sameMove(a: BotDecision, b: BotDecision, observation: BotObservationV1) {
  const x = targetOf(a, observation)
  const y = targetOf(b, observation)
  // A short all-in call is passive, including API encodings as raiseTo/allIn.
  if (x !== null && x <= observation.currentBet) a = { kind: 'call' }
  if (y !== null && y <= observation.currentBet) b = { kind: 'call' }
  return (
    (a.kind === b.kind && (a.kind !== 'raiseTo' || (b.kind === 'raiseTo' && a.to === b.to))) ||
    (x !== null && y !== null && x > observation.currentBet && x === y)
  )
}

export interface PreflopTrace {
  readonly pack: PreflopPack
  readonly node: PreflopNode
  readonly bb: number
  readonly players: readonly [string, string]
  readonly line: readonly { node: DecisionNode; indices: readonly number[] }[]
  readonly offTree: readonly number[]
  readonly selection: ReturnType<typeof selectPreflopDepth>
}

/** Stateless public replay: the same prefix always has the same translated node. */
export function tracePreflop(
  observation: BotObservationV1,
  history: readonly PublicDecision[],
  available: readonly PreflopPack[] = PREFLOP_DEPTHS.map((depth) => loadPreflopPack(depth)),
): PreflopTrace | string {
  const dealt = observation.seats.filter((s) => s.playerId !== null && s.betHand > 0)
  if (dealt.length !== 2 || observation.dealerSeat === undefined) return 'not heads-up'
  const button = dealt.find((s) => s.seat === observation.dealerSeat)
  const big = dealt.find((s) => s !== button)
  if (!button || !big) return 'missing blinds'
  const committed = (observation.actions ?? [])
    .filter((a) => a.seat === big.seat)
    .reduce((sum, a) => sum + (a.amountCommitted ?? 0), 0)
  const bb = big.betHand - committed
  if (bb <= 0) return 'missing blinds'
  const effective = Math.min(...dealt.map((s) => s.stack + s.betHand)) / bb
  const selection = selectPreflopDepth(
    effective,
    available.map((p) => p.metadata.effectiveStackBb),
  )
  const pack = available.find((p) => p.metadata.effectiveStackBb === selection.depth) as PreflopPack
  const players = [button.playerId as string, big.playerId as string] as const
  let node = pack.metadata.tree
  const line: { node: DecisionNode; indices: readonly number[] }[] = []
  const offTree: number[] = []
  const preflop = history.filter((d) => d.observation.street === 'preflop')
  for (const [index, entry] of preflop.entries()) {
    if (node.kind !== 'decision' || players[node.player] !== entry.observation.actor.playerId)
      return 'unseen sequence'
    const at = entry.observation
    const live = node.actions.map((a) => preflopLiveAction(a, at, bb))
    let indices = live.flatMap((a, k) => (sameMove(a, entry.taken.action, at) ? [k] : []))
    if (indices.length === 0) {
      const x = targetOf(entry.taken.action, at)
      if (x === null || x <= at.currentBet) return 'unseen sequence'
      const sizes = live
        .flatMap((a, k) => {
          const to = targetOf(a, at)
          return to !== null && to > at.currentBet ? [{ to, k }] : []
        })
        .sort((a, b) => a.to - b.to)
      if (sizes.length === 0) return 'unseen sequence'
      const lower = [...sizes].reverse().find((a) => a.to <= x) ?? sizes[0]
      const upper = sizes.find((a) => a.to >= x) ?? sizes.at(-1)
      if (!lower || !upper) return 'unseen sequence'
      const pot = at.pot + at.amountToCall
      const share = (to: number) => (to - at.currentBet) / pot
      const p = pseudoHarmonicLower(share(lower.to), share(x), share(upper.to))
      const seed = JSON.stringify([
        observation.roomId,
        observation.handNumber,
        preflop.slice(0, index + 1).map((d) => d.taken),
      ])
      indices = [mulberry32(seedFromString(seed))() < p ? lower.k : upper.k]
      offTree.push(index)
    }
    line.push({ node, indices })
    node = node.children[indices[0] as number] as PreflopNode
  }
  return { pack, node, bb, players, line, offTree, selection }
}

/** Raw realization weights, with board removal only; no normalization, pruning or smoothing. */
export function exactPreflopRanges(
  trace: PreflopTrace,
  board: readonly Card[],
  players: readonly [string, string],
): [WeightedHolding[], WeightedHolding[]] {
  const blocked = new Set(board.map(cardKey))
  const deck = makeDeck().filter((c) => !blocked.has(cardKey(c)))
  const ranges: [WeightedHolding[], WeightedHolding[]] = [[], []]
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const hole = [deck[i] as Card, deck[j] as Card] as const
      const weights = [1, 1]
      for (const { node, indices } of trace.line) {
        const row = tableRow(trace.pack, node, hole)
        weights[node.player] =
          (weights[node.player] as number) * indices.reduce((sum, k) => sum + (row[k] as number), 0)
      }
      for (const seat of [0, 1] as const) {
        const target = players.indexOf(trace.players[seat])
        if (target < 0) throw new Error('preflop range player mismatch')
        ranges[target as 0 | 1].push({ hole, weight: weights[seat] as number })
      }
    }
  return ranges
}

export function tablePreflopPolicy(
  base: BotPolicy,
  available = PREFLOP_DEPTHS.map((depth) => loadPreflopPack(depth)),
): TablePreflopSource {
  const stats: PreflopTableStats = {
    decisions: 0,
    preflopOffTree: 0,
    fallbacks: {},
    rangeFallbacks: 0,
    exactRanges: 0,
    packs: {},
    clampedBelow: 0,
    clampedAbove: 0,
  }
  const counted = new HandSolveCache<Set<string>>(true, 0)
  const record = (observation: BotObservationV1, trace: PreflopTrace) => {
    counted.observe(observation)
    const key = counted.key(observation, 'preflop')
    let seen = counted.get(key)
    if (!seen) {
      seen = new Set()
      counted.put(observation, key, seen)
    }
    if (!seen.has('pack')) {
      seen.add('pack')
      stats.packs[trace.selection.depth] = (stats.packs[trace.selection.depth] ?? 0) + 1
      if (trace.selection.clamp === 'below') stats.clampedBelow++
      if (trace.selection.clamp === 'above') stats.clampedAbove++
    }
    for (const index of trace.offTree)
      if (!seen.has(`off:${index}`)) {
        seen.add(`off:${index}`)
        stats.preflopOffTree++
      }
  }
  const policy: HandAwareBotPolicy = {
    id: 'preflop-tables',
    version: 1,
    releaseHand(roomId, handNumber) {
      counted.releaseHand(roomId, handNumber)
      releasePolicyHand(base, roomId, handNumber)
    },
    decide(context) {
      const { observation } = context
      if (observation.street !== 'preflop') return base.decide(context)
      const history = publicDecisions(observation)
      const trace =
        history === null ? 'missing history' : tracePreflop(observation, history, available)
      const reason =
        typeof trace === 'string'
          ? trace
          : trace.node.kind !== 'decision' ||
              trace.players[trace.node.player] !== observation.actor.playerId
            ? 'unseen sequence'
            : null
      if (reason !== null || typeof trace === 'string' || trace.node.kind !== 'decision') {
        const why = reason ?? 'unseen sequence'
        stats.fallbacks[why] = (stats.fallbacks[why] ?? 0) + 1
        return base.decide(context)
      }
      record(observation, trace)
      stats.decisions++
      const row = tableRow(trace.pack, trace.node, observation.actor.hole)
      const actions = trace.node.actions
      captureCumulativeStrategy(
        context.rng,
        row,
        (index) => preflopLiveAction(actions[index] as PreflopAction, observation, trace.bb),
        row.reduce((sum, value) => sum + value, 0),
      )
      const index = samplePreflopAction(row, context.rng)
      return {
        policyId: policy.id,
        policyVersion: 1,
        observationVersion: 1,
        decision: preflopLiveAction(
          trace.node.actions[index] as PreflopAction,
          observation,
          trace.bb,
        ),
        fallbackReason: null,
      }
    },
  }
  return {
    policy,
    stats,
    ranges(observation, history, players) {
      const trace = tracePreflop(observation, history, available)
      // A translated jam/call can end at an abstract all-in while the real
      // off-tree wager left chips behind. Its table reach still defines the belief.
      if (
        typeof trace === 'string' ||
        (trace.node.kind !== 'flop' && trace.node.kind !== 'all-in')
      ) {
        stats.rangeFallbacks++
        return null
      }
      record(observation, trace)
      stats.exactRanges++
      return exactPreflopRanges(trace, observation.board, players)
    },
  }
}
