import { personalityPool } from '@river/engine'
import { expect, it, vi } from 'vitest'
import { botPlayerId } from './bot-service.js'
import { openSessionHand } from './bot-session-benchmark.js'

const mock = vi.hoisted(() => ({
  post: vi.fn(),
  on: vi.fn(),
  release: vi.fn(),
  decide: vi.fn(() => {
    throw new Error('solver failed')
  }),
}))
vi.mock('node:worker_threads', () => ({
  parentPort: { postMessage: mock.post, on: mock.on },
  workerData: { variant: 'v9go' },
}))
vi.mock('./bot-v9g-policy.js', () => ({
  v9gPolicy: () => ({
    networks: {},
    caches: () => ({}),
    stats: { fallbacks: {} },
    turn: { fallbacks: {} },
    river: { fallbacks: {} },
    policy: { id: 'broken-solver', version: 1, decide: mock.decide, releaseHand: mock.release },
  }),
}))
vi.mock('./bot-river-policy.js', () => ({
  RIVER_CANDIDATE_TUNING: {},
  riverSolverPolicy: () => ({
    policy: {
      id: 'river-solver',
      version: 1,
      decide: () => ({
        policyId: 'river-solver',
        policyVersion: 1,
        observationVersion: 1,
        decision: { kind: 'call' },
        fallbackReason: null,
      }),
    },
  }),
}))

it('a real exception inside the synchronous solver returns the saved v8z action and releases its chain', async () => {
  await import('./bot-live-safe-worker.js')
  const handler = mock.on.mock.calls[0]?.[1] as (message: unknown) => void
  const cast = personalityPool()
    .filter((person) => person.skill === 'og')
    .slice(0, 2)
  const ids = cast.map((person) => botPlayerId(person.id))
  const { room } = openSessionHand(
    'worker-error',
    0,
    0,
    0,
    cast.map((personality) => ({ personality })),
    ids,
  )
  const playerId = room.viewFor('').currentActor?.playerId as string
  handler({
    type: 'think',
    id: 4,
    safe: true,
    request: {
      view: room.viewFor(playerId),
      playerId,
      personality: cast[ids.indexOf(playerId)],
      seed: 1,
      options: { roomId: room.id, publicActions: room.currentActions() },
    },
  })
  expect(mock.decide).toHaveBeenCalledOnce()
  expect(mock.post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: 'result',
      id: 4,
      reason: 'solver_error',
      action: { kind: 'call' },
      chains: 1,
    }),
  )
  handler({ type: 'release', roomId: room.id, handNumber: room.viewFor('').handNumber })
  expect(mock.release).toHaveBeenCalledWith(room.id, room.viewFor('').handNumber)
  expect(mock.post).toHaveBeenLastCalledWith({ type: 'released', chains: 0, entries: 0, bytes: 0 })
})
