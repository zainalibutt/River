import {
  type BotDecision,
  type BotObservationV1,
  type BotPolicy,
  blend,
  type Card,
  cardKey,
  DEFAULT_STAKE,
  handScore,
  makeDeck,
  mulberry32,
  seedFromString,
  type TurnAction,
} from '@river/engine'
import type { ProbeChoice } from './bot-lbr.js'
import { policyMoveShares } from './bot-lbr-query.js'
import {
  decisionClass,
  type MoveClass,
  recordedClass,
  type WeightedHolding,
} from './bot-lbr-range.js'
import { type HandAwareBotPolicy, releasePolicyHand } from './bot-policy-hand.js'
import { botPlayerId, decideWithFallback, observationFor, profileFor } from './bot-service.js'
import {
  type FocalDecisionPoint,
  openSessionHand,
  type SessionHandFrame,
} from './bot-session-benchmark.js'

export const SHARK2_TUNING = {
  /** Zero enumerates every live combo (1,225 before the flop). */
  maximumHoldings: 0,
  samplesPerHolding: 16,
  preflopRunouts: 48,
  continuationBoards: 8,
  flopRunouts: 48,
  turnRunouts: 32,
  smoothing: 0.02,
} as const

export interface Shark2Tuning {
  readonly maximumHoldings: number
  readonly samplesPerHolding: number
  readonly preflopRunouts: number
  readonly continuationBoards: number
  readonly flopRunouts: number
  readonly turnRunouts: number
  readonly smoothing: number
}

export interface Shark2Choice extends ProbeChoice {
  readonly decision: BotDecision
  readonly value: number
}

/** Flags can appear anywhere; legacy positional arguments retain their meaning. */
export function shark2Arguments(args: readonly string[]) {
  const positional: string[] = []
  const tuning: Partial<Shark2Tuning> = {}
  const settings: Record<string, keyof Shark2Tuning> = {
    holdings: 'maximumHoldings',
    draws: 'samplesPerHolding',
    'preflop-runouts': 'preflopRunouts',
    'continuation-boards': 'continuationBoards',
    'flop-runouts': 'flopRunouts',
    'turn-runouts': 'turnRunouts',
  }
  let enabled = false
  for (const arg of args) {
    if (arg === '--shark2') {
      enabled = true
      continue
    }
    if (!arg.startsWith('--shark2-')) {
      positional.push(arg)
      continue
    }
    const [flag, value] = arg.slice('--shark2-'.length).split('=')
    const key = flag === undefined ? undefined : settings[flag]
    const number = Number(value)
    if (
      !key ||
      value === undefined ||
      !Number.isSafeInteger(number) ||
      number < (key === 'maximumHoldings' ? 0 : 1)
    ) {
      throw new Error(`invalid shark2 flag ${arg}; use --shark2-<setting>=<integer>`)
    }
    Object.assign(tuning, { [key]: number })
  }
  if (!enabled && Object.keys(tuning).length > 0)
    throw new Error('shark2 settings require --shark2')
  return { enabled, positional, tuning }
}

interface HandState {
  readonly frame: SessionHandFrame
  readonly points: BotObservationV1[]
  range: WeightedHolding[] | null
  applied: number
}

/** All sizes are raise-to totals. Raises add a fraction of the pot AFTER calling. */
export function shark2Actions(observation: BotObservationV1): TurnAction[] {
  const { legal, currentBet, pot, amountToCall } = observation
  const targets =
    observation.street === 'preflop'
      ? currentBet <= DEFAULT_STAKE.bigBlind
        ? [2, 2.5, 3].map((size) => size * DEFAULT_STAKE.bigBlind)
        : [2.5, 3, 4].map((size) => size * currentBet)
      : [0.33, 0.66, 1, 1.5].map((size) => currentBet + size * (pot + amountToCall))
  const actions: TurnAction[] = []
  const seen = new Set<number>()
  if (legal.raiseTo.enabled) {
    for (const target of targets) {
      const to = Math.max(legal.raiseTo.min, Math.round(target))
      if (to >= legal.raiseTo.max || seen.has(to)) continue
      seen.add(to)
      actions.push({ kind: 'raiseTo', to })
    }
  }
  if (legal.allIn.enabled && observation.actor.stack > amountToCall) {
    actions.push({ kind: 'allIn' })
  }
  return actions
}

export function shark2Holdings(
  visible: readonly Card[],
  seed: string,
  maximum = 0,
): WeightedHolding[] {
  const blocked = new Set(visible.map(cardKey))
  const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const holdings: WeightedHolding[] = []
  for (let first = 0; first < deck.length; first++) {
    for (let second = first + 1; second < deck.length; second++) {
      holdings.push({ hole: [deck[first] as Card, deck[second] as Card], weight: 1 })
    }
  }
  if (maximum === 0 || maximum >= holdings.length) return holdings
  const random = mulberry32(seedFromString(seed))
  for (let at = holdings.length - 1; at > 0; at--) {
    const swap = Math.floor(random() * (at + 1))
    ;[holdings[at], holdings[swap]] = [
      holdings[swap] as WeightedHolding,
      holdings[at] as WeightedHolding,
    ]
  }
  return holdings.slice(0, maximum)
}

/** Exact on the river; independent, reproducible runouts on earlier streets. */
export function shark2Equity(
  observation: BotObservationV1,
  hole: readonly [Card, Card],
  tuning: Shark2Tuning,
): number {
  const { board } = observation
  const mine = observation.actor.hole
  const blocked = new Set([...mine, ...board, ...hole].map(cardKey))
  const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const samples =
    board.length === 5
      ? 1
      : board.length === 4
        ? tuning.turnRunouts
        : board.length === 3
          ? tuning.flopRunouts
          : tuning.preflopRunouts
  const random = mulberry32(
    seedFromString(
      `${observation.roomId}:${observation.actions?.length ?? 0}:${hole.map(cardKey)}:equity2`,
    ),
  )
  let won = 0
  for (let sample = 0; sample < samples; sample++) {
    const pool = [...deck]
    const completed = [...board]
    while (completed.length < 5) {
      completed.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as Card)
    }
    const ours = handScore([...mine, ...completed])
    const theirs = handScore([...hole, ...completed])
    won += ours > theirs ? 1 : ours === theirs ? 0.5 : 0
  }
  return won / samples
}

/**
 * Opt-in local response. The factory MUST construct independent mutable policy
 * closures; immutable model weights may be shared. Every hypothetical branch
 * gets a fresh instance, primed with the actual public history and invented
 * holdings, then released. The live focal policy is never queried.
 *
 * A focal re-raise is valued as a call. Before the river, we also value
 * waiting for the next street before committing the remaining stack, using
 * sampled next-street equities and the focal's jam-call frequency as a
 * continuation estimate. Otherwise thin early jams can destroy profitable
 * later opportunities. This is an estimate, not a full-game solve. A finite losing probe
 * is not an exploitability certificate.
 */
export function localBestResponse2(
  focal: BotPolicy,
  options: {
    readonly createQueryPolicy: () => BotPolicy
    readonly tuning?: Partial<Shark2Tuning>
    readonly onChoice?: (choice: Shark2Choice) => void
  },
) {
  const tuning: Shark2Tuning = { ...SHARK2_TUNING, ...options.tuning }
  for (const [key, value] of Object.entries(tuning)) {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (key !== 'smoothing' && !Number.isSafeInteger(value)) ||
      (value === 0 && key !== 'maximumHoldings' && key !== 'smoothing')
    ) {
      throw new Error(`invalid shark2 setting ${key}`)
    }
  }
  const stats = { exactQueries: 0, sampledQueries: 0, sampledDecisions: 0, rangeResets: 0 }
  let hand: HandState | undefined
  const watchHand = (frame: SessionHandFrame) => {
    hand = {
      frame: { ...frame, focalOptions: structuredClone(frame.focalOptions) },
      points: [],
      range: null,
      applied: 0,
    }
  }
  const watch = (point: FocalDecisionPoint) => {
    if (
      hand?.frame.roomId !== point.observation.roomId ||
      hand.frame.handNumber !== point.observation.handNumber
    ) {
      watchHand({
        seed: point.seed,
        session: point.session,
        hand: point.hand,
        startMs: point.startMs,
        entrants: point.entrants,
        focalOptions: point.focalOptions,
        roomId: point.observation.roomId,
        handNumber: point.observation.handNumber,
      })
    }
    // Never retain or consult the focal seat's dealt cards.
    hand?.points.push(
      structuredClone({ ...point.observation, actor: { ...point.observation.actor, hole: [] } }),
    )
  }
  const frequency = (
    state: HandState,
    observation: BotObservationV1,
    range: readonly WeightedHolding[],
    taken: MoveClass,
    history: readonly BotObservationV1[],
    seed: string,
  ): number[] => {
    const query = options.createQueryPolicy()
    if (query === focal) throw new Error('shark2 needs an independent query policy')
    const personality = state.frame.entrants[0]?.personality
    const neutral = range.find((holding) => holding.weight > 0)?.hole
    if (!personality || !neutral) return range.map(() => 0)
    // Copy public data once per branch, then freeze it. Copying a growing
    // history for every RNG draw costs far more than the policy lookup itself.
    const views = new Map<BotObservationV1, BotObservationV1>()
    const personalities = new Map<number, ReturnType<typeof blend>>()
    const contextFor = (view: BotObservationV1, hole: readonly [Card, Card], sample: number) => {
      let snapshot = views.get(view)
      if (!snapshot) {
        snapshot = freeze(structuredClone({ ...view, actor: { ...view.actor, hole: [] } }))
        views.set(view, snapshot)
      }
      const swapped = Object.freeze({
        ...snapshot,
        actor: Object.freeze({
          ...snapshot.actor,
          hole: freeze(hole.map((card) => ({ ...card }))),
        }),
      })
      let tilted = personalities.get(swapped.tilt.factor)
      if (!tilted) {
        tilted = freeze(blend(structuredClone(personality), swapped.tilt.factor))
        personalities.set(swapped.tilt.factor, tilted)
      }
      return {
        observation: swapped,
        personality: tilted,
        profile: freeze(profileFor(tilted)),
        tilt: swapped.tilt,
        rng: mulberry32(seedFromString(`${seed}:${sample}`)),
      }
    }
    try {
      for (const past of history) query.decide(contextFor(past, neutral, -1))
      const known = policyMoveShares(query, contextFor(observation, neutral, -1), taken)
      if (known !== null) {
        stats.exactQueries++
        return range.map((holding) =>
          holding.weight === 0 ? 0 : checkedShare(known(holding.hole)),
        )
      }
      stats.sampledQueries++
      return range.map((holding) => {
        if (holding.weight === 0) return 0
        let matches = 0
        for (let sample = 0; sample < tuning.samplesPerHolding; sample++) {
          const context = contextFor(observation, holding.hole, sample)
          const result = decideWithFallback(query, context)
          stats.sampledDecisions++
          if (decisionClass(result.decision, context.observation) === taken) matches++
        }
        return matches / tuning.samplesPerHolding
      })
    } finally {
      releasePolicyHand(query, observation.roomId, observation.handNumber)
    }
  }
  const policy: HandAwareBotPolicy = {
    id: 'local-best-response-2',
    version: 1,
    releaseHand(roomId, handNumber) {
      if (hand?.frame.roomId === roomId && hand.frame.handNumber === handNumber) hand = undefined
    },
    decide(context) {
      const observation = context.observation
      const state = hand
      if (
        !state ||
        state.frame.roomId !== observation.roomId ||
        state.frame.handNumber !== observation.handNumber
      ) {
        throw new Error('shark2 needs watchHand before the first probe decision')
      }
      const range =
        state.range ??
        shark2Holdings(
          [...observation.actor.hole, ...observation.board],
          `${observation.roomId}:range2`,
          tuning.maximumHoldings,
        )
      state.range = range
      const board = new Set(observation.board.map(cardKey))
      for (const holding of range) {
        if (holding.hole.some((card) => board.has(cardKey(card)))) holding.weight = 0
      }
      while (state.applied < state.points.length) {
        const past = state.points[state.applied] as BotObservationV1
        const taken = observation.actions?.[past.actions?.length ?? 0]
        if (!taken) break
        const exactBefore = stats.exactQueries
        const shares = frequency(
          state,
          past,
          range,
          recordedClass(taken, past),
          state.points.slice(0, state.applied),
          `${observation.roomId}:${state.applied}:move2`,
        )
        const exact = stats.exactQueries > exactBefore
        range.forEach((holding, at) => {
          const share = shares[at] as number
          holding.weight *= exact
            ? share
            : (share * tuning.samplesPerHolding + tuning.smoothing) /
              (tuning.samplesPerHolding + 2 * tuning.smoothing)
        })
        state.applied++
      }
      if (range.every((holding) => holding.weight === 0)) {
        stats.rangeResets++
        for (const holding of range)
          holding.weight = holding.hole.some((card) => board.has(cardKey(card))) ? 0 : 1
      }
      const wins = range.map((holding) =>
        holding.weight === 0 ? 0 : shark2Equity(observation, holding.hole, tuning),
      )
      const equity = weighted(range, wins)
      const { amountToCall, actor, pot } = observation
      const paid = Math.min(amountToCall, actor.stack)
      const aggressive = shark2Actions(observation).flatMap((action) => {
        const facing = facingAfter(state.frame, observation, action)
        if (facing === null) return []
        const folds = frequency(
          state,
          facing,
          range,
          'fold',
          state.points,
          `${observation.roomId}:${observation.actions?.length ?? 0}:fold2`,
        )
        return [{ action, facing, folds }]
      })
      const flops =
        observation.street === 'river' ? [] : continuationScenarios(observation, range, tuning)
      const jamFolds = aggressive.find((entry) => entry.action.kind === 'allIn')?.folds
      const continuing = (at: number) => 1 - (jamFolds?.[at] ?? 1)
      const opponentStack =
        observation.seats.find(
          (seat) => !seat.folded && seat.playerId !== actor.playerId && seat.playerId !== null,
        )?.stack ?? 0
      const waiting = waitingValue(
        range,
        wins,
        flops,
        continuing,
        Math.min(actor.stack - paid, opponentStack),
      )
      const choices: { decision: BotDecision; value: number; foldShare?: number }[] =
        amountToCall > 0
          ? [
              { decision: { kind: 'fold' }, value: 0 },
              {
                decision: { kind: 'call' },
                value: equity * (pot + paid - (amountToCall - paid)) - paid + waiting,
              },
            ]
          : [{ decision: { kind: 'check' }, value: equity * pot + waiting }]
      for (const { action, facing, folds } of aggressive) {
        const foldShare = weighted(range, folds)
        const calledEquity = weighted(range, wins, (at) => 1 - (folds[at] as number))
        const added = facing.pot - pot
        const called = Math.min(facing.amountToCall, facing.actor.stack)
        const uncalled = facing.amountToCall - called
        const future = waitingValue(
          range,
          wins,
          flops,
          (at) => continuing(at) * (1 - (folds[at] as number)),
          Math.min(actor.stack - added, facing.actor.stack - called),
        )
        const value =
          foldShare * pot +
          (1 - foldShare) * (calledEquity * (facing.pot + called - uncalled) - (added - uncalled)) +
          future
        choices.push({ decision: action, value, foldShare })
      }
      let best = choices[0] as (typeof choices)[number]
      for (const choice of choices) if (choice.value > best.value + 1e-8) best = choice
      options.onChoice?.({ ...best, street: observation.street, kind: best.decision.kind, equity })
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: observation.version,
        decision: best.decision,
        fallbackReason: null,
      }
    },
  }
  return { policy, watch, watchHand, tuning, stats }
}

/** Shared sampled boards expose the option value of committing on the next street. */
function continuationScenarios(
  observation: BotObservationV1,
  range: readonly WeightedHolding[],
  tuning: Shark2Tuning,
) {
  const blocked = new Set([...observation.actor.hole, ...observation.board].map(cardKey))
  const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const random = mulberry32(
    seedFromString(`${observation.roomId}:${observation.actions?.length ?? 0}:waiting`),
  )
  const needed = observation.street === 'preflop' ? 3 : 1
  let correction = 1
  for (let at = 0; at < needed; at++) correction *= (deck.length - at) / (deck.length - 2 - at)
  return Array.from({ length: tuning.continuationBoards }, () => {
    const pool = [...deck]
    const board: Card[] = [...observation.board]
    for (let at = 0; at < needed; at++)
      board.push(pool.splice(Math.floor(random() * pool.length), 1)[0] as Card)
    const taken = new Set(board.map(cardKey))
    const live = range.map((holding) => !holding.hole.some((card) => taken.has(cardKey(card))))
    const future = {
      ...observation,
      street:
        board.length === 3
          ? ('flop' as const)
          : board.length === 4
            ? ('turn' as const)
            : ('river' as const),
      board,
    }
    const samples = {
      ...tuning,
      flopRunouts: Math.max(1, Math.ceil(tuning.preflopRunouts / tuning.continuationBoards)),
      turnRunouts: Math.max(1, Math.ceil(tuning.flopRunouts / tuning.continuationBoards)),
    }
    const wins = range.map((holding, at) =>
      holding.weight === 0 || !live[at] ? 0 : shark2Equity(future, holding.hole, samples),
    )
    return { live, wins, correction }
  })
}

function waitingValue(
  range: readonly WeightedHolding[],
  wins: readonly number[],
  flops: readonly { live: readonly boolean[]; wins: readonly number[]; correction: number }[],
  continues: (at: number) => number,
  remaining: number,
): number {
  if (flops.length === 0 || remaining <= 0) return 0
  const total = range.reduce((sum, holding) => sum + holding.weight, 0)
  if (total === 0) return 0
  const immediate =
    range.reduce(
      (sum, holding, at) => sum + holding.weight * continues(at) * (2 * (wins[at] as number) - 1),
      0,
    ) / total
  const participation =
    range.reduce((sum, holding, at) => sum + holding.weight * continues(at), 0) / total
  let future = 0
  for (const flop of flops) {
    let gain = 0
    range.forEach((holding, at) => {
      if (flop.live[at])
        gain += holding.weight * continues(at) * (2 * (flop.wins[at] as number) - 1)
    })
    future += Math.max(0, gain / total) * flop.correction
  }
  // Boards exclude our cards. Importance-correct for the two focal blockers.
  // Jensen's lower bound also prevents
  // MC noise from making waiting look worse than committing immediately.
  return remaining * Math.min(participation, Math.max(0, immediate, future / flops.length))
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function checkedShare(share: number): number {
  if (!Number.isFinite(share) || share < -1e-9 || share > 1 + 1e-9)
    throw new Error('invalid shark2 probability hook')
  return Math.max(0, Math.min(1, share))
}

function weighted(
  range: readonly WeightedHolding[],
  values: readonly number[],
  scale: (at: number) => number = () => 1,
): number {
  let total = 0
  let sum = 0
  range.forEach((holding, at) => {
    const weight = holding.weight * scale(at)
    total += weight
    sum += weight * (values[at] as number)
  })
  return total === 0 ? 0.5 : sum / total
}

/** Replay only public actions; the focal hole is immediately discarded. */
function facingAfter(
  frame: SessionHandFrame,
  observation: BotObservationV1,
  action: TurnAction,
): BotObservationV1 | null {
  const ids = frame.entrants.map((entrant) => botPlayerId(entrant.personality.id))
  const { room } = openSessionHand(
    frame.seed,
    frame.session,
    frame.hand,
    frame.startMs,
    frame.entrants,
    ids,
  )
  const idBySeat = new Map(room.viewFor('').seats.map((seat) => [seat.seat, seat.playerId]))
  for (const entry of observation.actions ?? []) {
    const playerId = idBySeat.get(entry.seat)
    if (!playerId || !room.submit({ kind: 'act', playerId, action: entry.action }).ok)
      throw new Error('shark2 replay diverged')
  }
  const actorId = observation.actor.playerId
  const before = room.viewFor(actorId)
  if (before.currentActor?.playerId !== actorId || before.pot !== observation.pot)
    throw new Error('shark2 replay diverged')
  if (!room.submit({ kind: 'act', playerId: actorId, action }).ok) return null
  const focalId = ids[0] as string
  const facing = observationFor(
    room.viewFor(focalId),
    focalId,
    undefined,
    room.id,
    room.currentActions(),
    frame.focalOptions.opponentSummaries,
    frame.focalOptions.opponentStats,
  )
  return facing === null ? null : { ...facing, actor: { ...facing.actor, hole: [] } }
}
