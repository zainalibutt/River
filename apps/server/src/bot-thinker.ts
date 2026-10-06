import { Worker } from 'node:worker_threads'
import type { BotPersonality, TurnAction } from '@river/engine'
import type { BotActionOptions } from './bot-service.js'
import type { RoomView } from './protocol.js'

/** The parts of a bot's action options that are plain data, which is all a worker thread can receive. */
export type PlainActionOptions = Omit<BotActionOptions, 'policy' | 'trace'>

/** Everything a bot's decision needs, as plain data. */
export interface ThinkRequest {
  readonly view: RoomView
  readonly playerId: string
  readonly personality: BotPersonality
  /** Seeds the decision's random choices. */
  readonly seed: number
  readonly options: PlainActionOptions
}

/**
 * Works out the decisions that are too slow for the server's one thread, away
 * from it. Only the decisions it `wants` are sent; if it has no answer by the
 * deadline it gives null, and the bot plays the quick decision instead.
 */
export interface BotRiverThinker {
  wants(view: RoomView, playerId: string, personality: BotPersonality): boolean
  think(request: ThinkRequest, deadlineMs: number): Promise<TurnAction | null>
  close(): Promise<void>
}

/** An OG deciding at a river with two players left: the decisions the river solver takes. */
export function isSolvedRiver(view: RoomView, playerId: string, personality: BotPersonality) {
  return (
    personality.skill === 'og' &&
    view.street === 'river' &&
    view.currentActor?.playerId === playerId &&
    view.seats.filter((seat) => seat.playerId !== null && seat.hasHole && !seat.folded).length === 2
  )
}

/**
 * A thinker backed by one worker thread running the river solver. The worker
 * starts on first use and keeps its solved spots between decisions; if it
 * fails, the decisions waiting on it get null and the next one starts a new
 * worker. `execArgv` lets tests load the TypeScript source through tsx.
 */
export function workerRiverThinker(
  options: { readonly execArgv?: string[] } = {},
): BotRiverThinker {
  let worker: Worker | null = null
  let next = 0
  const pending = new Map<number, (action: TurnAction | null) => void>()
  const start = (): Worker => {
    const source = import.meta.url.endsWith('.ts')
      ? './bot-think-worker.ts'
      : './bot-think-worker.js'
    const created = new Worker(
      new URL(source, import.meta.url),
      options.execArgv === undefined ? {} : { execArgv: options.execArgv },
    )
    created.on(
      'message',
      (message: { readonly id: number; readonly action: TurnAction | null }) => {
        pending.get(message.id)?.(message.action)
      },
    )
    const fail = () => {
      if (worker === created) worker = null
      for (const answer of pending.values()) answer(null)
    }
    created.on('error', fail)
    created.on('exit', fail)
    created.unref()
    return created
  }
  return {
    wants: isSolvedRiver,
    think(request, deadlineMs) {
      worker ??= start()
      const id = next
      next += 1
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          resolve(null)
        }, deadlineMs)
        pending.set(id, (action) => {
          clearTimeout(timer)
          pending.delete(id)
          resolve(action)
        })
        worker?.postMessage({ id, ...request })
      })
    },
    async close() {
      const running = worker
      worker = null
      await running?.terminate()
    },
  }
}
