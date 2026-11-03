import { afterEach, describe, expect, it, vi } from 'vitest'
import { V9GP_POLICY_OPTIONS } from './bot-v9g-policy.js'

const worker = vi.hoisted(() => ({
  data: { variant: 'v9go' },
  create: vi.fn(() => ({ networks: {} })),
}))

vi.mock('node:worker_threads', () => ({
  workerData: worker.data,
  parentPort: { on: vi.fn(), postMessage: vi.fn() },
}))
vi.mock('./bot-v9g-policy.js', async (original) => ({
  ...(await original<typeof import('./bot-v9g-policy.js')>()),
  v9gPolicy: worker.create,
}))

afterEach(() => vi.unstubAllEnvs())

describe('live-safe worker variant construction', () => {
  it.each(['v9go', 'v9gp', 'v9gpw', 'v9gpw2'] as const)(
    'constructs %s with its shared chain options',
    async (variant) => {
      vi.stubEnv('RIVER_VALUE_THREADS', process.env.RIVER_VALUE_THREADS)
      vi.stubEnv('RIVER_VALUE_BACKEND', process.env.RIVER_VALUE_BACKEND)
      vi.resetModules()
      worker.create.mockClear()
      worker.data.variant = variant
      await import('./bot-live-safe-worker.js')
      expect(worker.create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          variant === 'v9go' ? { offTree: 'resolve' } : V9GP_POLICY_OPTIONS[variant],
        ),
        undefined,
      )
    },
  )
})
