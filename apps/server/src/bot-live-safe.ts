import { Worker } from 'node:worker_threads'
import { mulberry32, type TurnAction } from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { actionFor } from './bot-service.js'
import { type BotRiverThinker, workerRiverThinker } from './bot-thinker.js'

export type LiveSafeVariant = 'v9go' | 'v9gp' | 'v9gpw' | 'v9gpw2'

export function liveSafeVariant(value: string | undefined): LiveSafeVariant {
  return value === 'v9go' || value === 'v9gp' || value === 'v9gpw' ? value : 'v9gpw2'
}

export interface LiveSafeConfig {
  enabled: boolean
  variant: LiveSafeVariant
  budgetMs: number
  threads: number
  maxHands: number
  maxDecisionsPerHand: number
  /**
   * How long before the budget a 2x solve stops adding iterations and plays
   * the best answer it has, never fewer than the 1x count. 0 turns it off.
   */
  anytimeMarginMs: number
}

function integer(text: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(text)
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

export function liveSafeConfig(env: NodeJS.ProcessEnv = process.env): LiveSafeConfig {
  return {
    enabled: env.BOT_LIVE_SAFE === 'true',
    variant: liveSafeVariant(env.BOT_LIVE_SAFE_VARIANT),
    budgetMs: integer(env.BOT_LIVE_SAFE_BUDGET_MS, 8_000, 1, 8_000),
    threads: integer(env.BOT_LIVE_SAFE_THREADS, 2, 1, 4),
    maxHands: integer(env.BOT_LIVE_SAFE_MAX_HANDS, 8, 1, 64),
    maxDecisionsPerHand: integer(env.BOT_LIVE_SAFE_MAX_DECISIONS, 64, 1, 256),
    anytimeMarginMs: integer(env.BOT_LIVE_SAFE_ANYTIME_MARGIN_MS, 2_000, 0, 7_999),
  }
}

export interface LiveSafeEvent {
  type: 'decision' | 'ready'
  street?: string
  ms?: number
  reason?: string | null
  fallback?: 'v8z' | 'guard' | null
  coldStartMs?: number
  modelError?: string
  backends?: string[]
  /** Solves this decision cut short at the deadline, each after at least its 1x count. */
  shortened?: number
}

export interface LiveSafeBotPolicy extends BotRiverThinker {
  ready(): Promise<void>
  releaseHand(roomId: string, handNumber: number): void
  readonly stats: {
    decisions: number
    safeDecisions: number
    fallbacks: Record<string, number>
    guardFallbacks: number
    workerStarts: number
    coldStartMs: number
    shortenedSolves: number
  }
  diagnostics(): { activeHands: number; chains: number; entries: number; bytes: number }
}

interface Hand {
  roomId: string
  number: number
  slot: Slot
  decisions: number
  disabled: boolean
}
interface Slot {
  worker: Worker | null
  retiring: Promise<unknown> | null
  pending: {
    id: number
    roomId: string
    handNumber: number
    baseline: TurnAction | null
    shortened: number
    finish(action: TurnAction | null, reason: string | null): void
  } | null
  ready: Promise<void> | null
  loaded(): void
  memory: { chains: number; entries: number; bytes: number }
}

/**
 * Async live policy: solves never block the room's event loop. A wall-clock
 * timer terminates the entire solve, including tracking and off-tree re-solves.
 * Each slot is single-threaded; the configured pool is the total CPU limit.
 */
export function liveSafeBotPolicy(
  config: LiveSafeConfig = liveSafeConfig(),
  options: {
    execArgv?: string[]
    onEvent?: (event: LiveSafeEvent) => void
    workerFactory?: () => Worker
  } = {},
): LiveSafeBotPolicy {
  const slots: Slot[] = Array.from({ length: config.threads }, () => ({
    worker: null,
    retiring: null,
    pending: null,
    ready: null,
    loaded() {},
    memory: { chains: 0, entries: 0, bytes: 0 },
  }))
  const hands = new Map<string, Hand>()
  let closed = false
  let sequence = 0
  const stats = {
    decisions: 0,
    safeDecisions: 0,
    fallbacks: {} as Record<string, number>,
    guardFallbacks: 0,
    workerStarts: 0,
    coldStartMs: 0,
    shortenedSolves: 0,
  }
  const emit = (event: LiveSafeEvent) => {
    try {
      options.onEvent?.(event)
    } catch {
      /* Telemetry must not affect a room. */
    }
  }
  const stop = (slot: Slot) => {
    const running = slot.worker
    slot.worker = null
    slot.ready = null
    slot.loaded()
    slot.memory = { chains: 0, entries: 0, bytes: 0 }
    for (const hand of hands.values()) if (hand.slot === slot) hand.disabled = true
    if (running !== null) {
      slot.retiring = running
        .terminate()
        .catch(() => undefined)
        .finally(() => {
          slot.retiring = null
        })
    }
  }
  const start = (slot: Slot) => {
    if (slot.worker !== null) return
    slot.ready = new Promise((resolve) => {
      slot.loaded = resolve
    })
    const source = import.meta.url.endsWith('.ts')
      ? './bot-live-safe-worker.ts'
      : './bot-live-safe-worker.js'
    const worker =
      options.workerFactory?.() ??
      new Worker(new URL(source, import.meta.url), {
        workerData: { variant: config.variant },
        ...(options.execArgv === undefined ? {} : { execArgv: options.execArgv }),
        resourceLimits: { maxOldGenerationSizeMb: 512 },
      })
    slot.worker = worker
    stats.workerStarts += 1
    worker.on('message', (message) => {
      if (slot.worker !== worker) return
      if (message.type === 'ready') {
        stats.coldStartMs = Math.max(stats.coldStartMs, message.coldStartMs)
        slot.loaded()
        emit(message)
      } else if (message.type === 'released' || message.type === 'result') {
        slot.memory = { chains: message.chains, entries: message.entries, bytes: message.bytes }
        if (message.type === 'result' && message.id === slot.pending?.id) {
          if (slot.pending !== null) slot.pending.shortened = message.shortened ?? 0
          slot.pending?.finish(message.action, message.reason)
        }
      } else if (message.type === 'baseline' && message.id === slot.pending?.id) {
        if (slot.pending !== null) slot.pending.baseline = message.action
      }
    })
    const fail = () => {
      if (slot.worker !== worker) return
      const pending = slot.pending
      stop(slot)
      pending?.finish(pending.baseline, 'worker_error')
    }
    worker.on('error', fail)
    worker.on('exit', fail)
    worker.unref()
  }
  const policy: LiveSafeBotPolicy = {
    stats,
    wants(view, playerId, personality) {
      return (
        config.enabled &&
        view.seats.length === 2 &&
        playerId === 'bot:midas' &&
        personality.id === 'midas' &&
        personality.skill === 'og' &&
        view.currentActor?.playerId === playerId
      )
    },
    async ready() {
      if (closed) return
      await Promise.all(
        slots.map(async (slot) => {
          if (slot.retiring !== null) await slot.retiring
          try {
            start(slot)
            await Promise.race([
              slot.ready,
              new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                  stop(slot)
                  resolve()
                }, config.budgetMs)
                slot.ready?.then(() => clearTimeout(timer))
              }),
            ])
          } catch {
            stop(slot)
          }
        }),
      )
    },
    async think(request, deadlineMs) {
      const started = performance.now()
      const budget = Math.max(1, Math.min(config.budgetMs, deadlineMs))
      stats.decisions += 1
      const roomId = request.options.roomId ?? 'local'
      const key = JSON.stringify([roomId, request.view.handNumber, request.playerId])
      const eligible = policy.wants(request.view, request.playerId, request.personality)
      let hand = hands.get(key)
      const guard = () => {
        try {
          return actionFor(
            request.view,
            request.playerId,
            request.personality,
            mulberry32(request.seed),
            {
              ...request.options,
              policy: pokerGuardPolicy,
            },
          )
        } catch {
          return null
        }
      }
      const report = (
        action: TurnAction | null,
        reason: string | null,
        baseline: boolean,
        shortened = 0,
      ) => {
        const chosen = action ?? guard()
        // Before the river v8z delegates to this exact guard, with the same RNG.
        const usedV8z = baseline || (chosen !== null && request.view.street !== 'river')
        if (reason !== null) {
          stats.fallbacks[reason] = (stats.fallbacks[reason] ?? 0) + 1
          if (hand !== undefined) hand.disabled = true
          if (!usedV8z) stats.guardFallbacks += 1
        } else if (eligible) stats.safeDecisions += 1
        emit({
          type: 'decision',
          street: request.view.street,
          ms: performance.now() - started,
          reason,
          fallback: reason === null ? null : usedV8z ? 'v8z' : 'guard',
          ...(shortened > 0 ? { shortened } : {}),
        })
        return chosen
      }
      if (closed) return report(null, 'closed', false)
      let reason: string | null = null
      if (eligible && hand === undefined && hands.size >= config.maxHands) reason = 'hand_capacity'
      const actorSeat = request.view.seats.find((seat) => seat.playerId === request.playerId)?.seat
      if (
        eligible &&
        hand === undefined &&
        request.options.publicActions?.some((action) => action.seat === actorSeat)
      ) {
        reason = 'missing_carry'
      }
      const available = slots.find((entry) => entry.pending === null && entry.retiring === null)
      // Carry requires affinity; v8z fallback does not. In particular, a hand
      // whose worker timed out can use another slot while termination completes.
      let slot = (hand?.disabled ? undefined : hand?.slot) ?? available
      if (slot !== undefined && (slot.pending !== null || slot.retiring !== null)) {
        reason = 'worker_busy'
        if (hand !== undefined) hand.disabled = true
        slot = available
      }
      if (slot === undefined || slot.pending !== null || slot.retiring !== null) {
        // No unbounded queue and no third worker on an oversubscribed CPU.
        return report(null, 'worker_busy', false)
      }
      if (eligible && hand === undefined && reason === null) {
        hand = { roomId, number: request.view.handNumber, slot, decisions: 0, disabled: false }
        hands.set(key, hand)
      }
      if (hand !== undefined) {
        hand.decisions += 1
        if (hand.disabled) reason ??= 'hand_disabled'
        else if (hand.decisions > config.maxDecisionsPerHand) reason = 'hand_decision_limit'
      }
      return new Promise<TurnAction | null>((resolve) => {
        let settled = false
        const id = sequence++
        const finish = (action: TurnAction | null, failure: string | null) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const shortened = slot.pending?.id === id ? slot.pending.shortened : 0
          stats.shortenedSolves += shortened
          slot.pending = null
          const why = failure ?? reason
          if (why !== null && hand !== undefined) {
            // Discard all carried solves once an action came from the fallback.
            try {
              for (const owner of slots) {
                owner.worker?.postMessage({ type: 'release', roomId, handNumber: hand.number })
              }
            } catch {
              stop(slot)
            }
          }
          resolve(report(action, why, action !== null && why !== null, shortened))
        }
        const timer = setTimeout(
          () => {
            const baseline = slot.pending?.baseline ?? null
            stop(slot)
            finish(baseline, 'time_budget')
          },
          Math.max(1, budget - (performance.now() - started)),
        )
        slot.pending = {
          id,
          roomId,
          handNumber: request.view.handNumber,
          baseline: null,
          shortened: 0,
          finish,
        }
        try {
          start(slot)
          slot.worker?.postMessage({
            type: 'think',
            id,
            request,
            safe: eligible && reason === null,
            // Relative, so the two threads need not share a clock origin.
            ...(config.anytimeMarginMs > 0
              ? {
                  stopAfterMs: Math.max(
                    1,
                    budget - (performance.now() - started) - config.anytimeMarginMs,
                  ),
                }
              : {}),
          })
        } catch {
          stop(slot)
          finish(null, 'worker_error')
        }
      })
    },
    releaseHand(roomId, handNumber) {
      for (const [key, hand] of hands) {
        if (hand.roomId === roomId && hand.number === handNumber) hands.delete(key)
      }
      for (const slot of slots) {
        const pending = slot.pending
        if (pending?.roomId === roomId && pending.handNumber === handNumber) {
          stop(slot)
          pending.finish(pending.baseline, 'hand_ended')
        }
        try {
          slot.worker?.postMessage({ type: 'release', roomId, handNumber })
        } catch {
          stop(slot)
        }
      }
    },
    diagnostics() {
      return {
        activeHands: hands.size,
        chains: slots.reduce((sum, slot) => sum + slot.memory.chains, 0),
        entries: slots.reduce((sum, slot) => sum + slot.memory.entries, 0),
        bytes: slots.reduce((sum, slot) => sum + slot.memory.bytes, 0),
      }
    },
    async close() {
      closed = true
      for (const slot of slots) {
        const pending = slot.pending
        stop(slot)
        pending?.finish(pending.baseline, 'closed')
      }
      hands.clear()
      await Promise.all(slots.map((slot) => slot.retiring))
    },
  }
  return policy
}

/** Flag off selects exactly the old worker and honours its existing flag. */
export function liveBotThinker(
  env: NodeJS.ProcessEnv = process.env,
  options: Parameters<typeof liveSafeBotPolicy>[1] = {},
): BotRiverThinker | undefined {
  const config = liveSafeConfig(env)
  if (config.enabled) return liveSafeBotPolicy(config, options)
  return env.BOT_RIVER_SOLVER === 'true' ? workerRiverThinker() : undefined
}
