import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { mulberry32, personalityPool } from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { liveBotThinker, liveSafeBotPolicy, liveSafeConfig } from './bot-live-safe.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { hasPreflopPack } from './bot-preflop-tables.js'
import { actionFor, botPlayerId } from './bot-service.js'
import { openSessionHand } from './bot-session-benchmark.js'
import type { ThinkRequest } from './bot-thinker.js'
import { workerRiverThinker } from './bot-thinker.js'

/** The v3 pack is private; a fresh clone skips the tests that play it. */
const v3 = hasPreflopPack('v3')

vi.mock('./bot-thinker.js', async (original) => ({
  ...(await original<typeof import('./bot-thinker.js')>()),
  workerRiverThinker: vi.fn(() => ({ legacy: true })),
}))

function request(): ThinkRequest {
  const cast = personalityPool()
    .filter((person) => person.skill === 'og')
    .slice(0, 2)
  const entrants = cast.map((personality) => ({ personality }))
  const ids = cast.map((personality) => botPlayerId(personality.id))
  const { room } = openSessionHand('safe-live-tests', 0, 0, 0, entrants, ids)
  const actor = room.viewFor('').currentActor?.playerId as string
  return {
    view: room.viewFor(actor),
    playerId: actor,
    personality: cast[ids.indexOf(actor)] as never,
    seed: 7,
    options: { roomId: room.id, publicActions: room.currentActions() },
  }
}

class FakeWorker extends EventEmitter {
  readonly sent: { type: string; safe?: boolean; id?: number }[] = []
  readonly terminate = vi.fn(async () => 0)
  constructor(
    private readonly respond: (worker: FakeWorker, message: FakeWorker['sent'][number]) => void,
  ) {
    super()
    queueMicrotask(() => this.emit('message', { type: 'ready', coldStartMs: 5 }))
  }
  postMessage(message: FakeWorker['sent'][number]) {
    this.sent.push(message)
    this.respond(this, message)
  }
  unref() {}
  send(id: number | undefined, reason: string | null = null) {
    this.emit('message', {
      type: 'result',
      id,
      action: { kind: 'call' },
      reason,
      chains: 0,
      entries: 0,
      bytes: 0,
    })
  }
}

afterEach(() => vi.useRealTimers())

describe('live safe policy routing and hard budget', () => {
  it('defaults OFF and selects exactly the old live factory with the old flag', () => {
    vi.mocked(workerRiverThinker).mockClear()
    expect(liveSafeConfig({})).toMatchObject({
      enabled: false,
      threads: 2,
      variant: 'v9go',
      budgetMs: 8000,
    })
    expect(liveBotThinker({})).toBeUndefined()
    expect(workerRiverThinker).not.toHaveBeenCalled()
    const old = { BOT_RIVER_SOLVER: 'true', BOT_LIVE_SAFE: 'false' }
    expect(liveBotThinker(old)).toEqual({ legacy: true })
    expect(workerRiverThinker).toHaveBeenCalledExactlyOnceWith()
  })

  it('only opts in with true and validates resource settings', () => {
    expect(liveSafeConfig({ BOT_LIVE_SAFE: '1', BOT_LIVE_SAFE_THREADS: '99' })).toMatchObject({
      enabled: false,
      threads: 2,
    })
    expect(
      liveSafeConfig({
        BOT_LIVE_SAFE: 'true',
        BOT_LIVE_SAFE_VARIANT: 'v9gp',
        BOT_LIVE_SAFE_THREADS: '1',
      }),
    ).toMatchObject({ enabled: true, variant: 'v9gp', threads: 1 })
  })

  it('never requests v9go on a multiway table, even after folds leave two players', async () => {
    const worker = new FakeWorker((worker, message) => worker.send(message.id))
    const policy = liveSafeBotPolicy(
      { ...liveSafeConfig(), enabled: true, threads: 1 },
      {
        workerFactory: () => worker as unknown as Worker,
      },
    )
    try {
      const original = request()
      const extra = {
        ...(original.view.seats[0] as NonNullable<(typeof original.view.seats)[0]>),
        seat: 2,
        folded: true,
      }
      const req = {
        ...original,
        view: { ...original.view, seats: [...original.view.seats, extra] },
      }
      expect(policy.wants(req.view, req.playerId, req.personality)).toBe(false)
      expect(await policy.think(req, 8000)).toEqual({ kind: 'call' })
      expect(worker.sent.find((message) => message.type === 'think')?.safe).toBe(false)
      expect(policy.stats.safeDecisions).toBe(0)
      expect(policy.diagnostics().activeHands).toBe(0)
    } finally {
      await policy.close()
    }
  })

  it('terminates timed-out solves, returns v8z, counts the fallback and disables carry', async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const policy = liveSafeBotPolicy(
      { ...liveSafeConfig(), enabled: true, threads: 1, budgetMs: 20 },
      {
        workerFactory: () => {
          const worker = new FakeWorker((worker, message) => {
            if (message.type === 'think')
              worker.emit('message', { type: 'baseline', id: message.id, action: { kind: 'call' } })
          })
          workers.push(worker)
          return worker as unknown as Worker
        },
      },
    )
    try {
      const req = request()
      const result = policy.think(req, 1000)
      await vi.advanceTimersByTimeAsync(20)
      expect(await result).toEqual({ kind: 'call' })
      expect(workers[0]?.terminate).toHaveBeenCalledOnce()
      expect(policy.stats.fallbacks.time_budget).toBe(1)
      expect(policy.stats.guardFallbacks).toBe(0)
      const again = policy.think(req, 1000)
      expect(workers[1]?.sent.find((message) => message.type === 'think')?.safe).toBe(false)
      await vi.advanceTimersByTimeAsync(20)
      await again
      policy.releaseHand(req.options.roomId as string, req.view.handNumber)
      expect(policy.diagnostics().activeHands).toBe(0)
    } finally {
      await policy.close()
    }
  })

  it('uses and counts v8z on solver errors without throwing into a room', async () => {
    const worker = new FakeWorker((worker, message) => {
      if (message.type === 'think') worker.send(message.id, 'solver_error')
    })
    const policy = liveSafeBotPolicy(
      { ...liveSafeConfig(), enabled: true, threads: 1 },
      {
        workerFactory: () => worker as unknown as Worker,
      },
    )
    try {
      await expect(policy.think(request(), 8000)).resolves.toEqual({ kind: 'call' })
      expect(policy.stats.fallbacks.solver_error).toBe(1)
      expect(worker.sent.some((message) => message.type === 'release')).toBe(true)
    } finally {
      await policy.close()
    }
  })

  it.skipIf(!v3)(
    'preempts a genuinely blocked worker rather than waiting for its JS to yield',
    async () => {
      const policy = liveSafeBotPolicy(
        { ...liveSafeConfig(), enabled: true, threads: 1, budgetMs: 200 },
        {
          workerFactory: () =>
            new Worker(
              `
          const { parentPort } = require('node:worker_threads')
          parentPort.postMessage({ type: 'ready', coldStartMs: 0 })
          parentPort.on('message', (message) => {
            parentPort.postMessage({ type: 'baseline', id: message.id, action: { kind: 'call' } })
            while (true) {}
          })
        `,
              { eval: true },
            ),
        },
      )
      try {
        await policy.ready()
        const started = performance.now()
        await expect(policy.think(request(), 200)).resolves.toEqual({ kind: 'call' })
        expect(performance.now() - started).toBeLessThan(1000)
        expect(policy.stats.fallbacks.time_budget).toBe(1)
      } finally {
        await policy.close()
      }
    },
  )

  it('runs v8z on a free slot while the timed-out affinity worker is still retiring', async () => {
    vi.useFakeTimers()
    let retired = () => {}
    const first = new FakeWorker((worker, message) => {
      if (message.type === 'think')
        worker.emit('message', {
          type: 'baseline',
          id: message.id,
          action: { kind: 'call' },
        })
    })
    first.terminate.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          retired = () => resolve(0)
        }),
    )
    const spare = new FakeWorker((worker, message) => {
      if (message.type === 'think') worker.send(message.id)
    })
    const workers = [first, spare]
    const policy = liveSafeBotPolicy(
      { ...liveSafeConfig(), enabled: true, threads: 2, budgetMs: 20 },
      { workerFactory: () => workers.shift() as unknown as Worker },
    )
    try {
      await policy.ready()
      const req = request()
      const timed = policy.think(req, 20)
      await vi.advanceTimersByTimeAsync(20)
      expect(await timed).toEqual({ kind: 'call' })
      await expect(policy.think(req, 20)).resolves.toEqual({ kind: 'call' })
      expect(spare.sent.find((message) => message.type === 'think')?.safe).toBe(false)
      expect(policy.stats.fallbacks).toEqual({ time_budget: 1, hand_disabled: 1 })
      expect(policy.stats.guardFallbacks).toBe(0)
      expect(policy.stats.workerStarts).toBe(2)
    } finally {
      retired()
      await policy.close()
    }
  })

  it('does not queue work or exceed the worker/hand limits and cancels a settled solve', async () => {
    const worker = new FakeWorker(() => {})
    const policy = liveSafeBotPolicy(
      { ...liveSafeConfig(), enabled: true, threads: 1, maxHands: 1 },
      {
        workerFactory: () => worker as unknown as Worker,
      },
    )
    try {
      const req = request()
      const first = policy.think(req, 8000)
      const expected = actionFor(req.view, req.playerId, req.personality, mulberry32(req.seed), {
        ...req.options,
        policy: pokerGuardPolicy,
      })
      await expect(
        policy.think({ ...req, options: { ...req.options, roomId: 'other' } }, 8000),
      ).resolves.toEqual(expected)
      expect(policy.stats.fallbacks.worker_busy).toBe(1)
      expect(policy.stats.guardFallbacks).toBe(0)
      expect(policy.stats.workerStarts).toBe(1)
      expect(policy.diagnostics().activeHands).toBe(1)
      policy.releaseHand(req.options.roomId as string, req.view.handNumber)
      await expect(first).resolves.not.toBeNull()
      expect(policy.stats.fallbacks.hand_ended).toBe(1)
      expect(worker.terminate).toHaveBeenCalledOnce()
      expect(policy.diagnostics().activeHands).toBe(0)
    } finally {
      await policy.close()
    }
  })
})
