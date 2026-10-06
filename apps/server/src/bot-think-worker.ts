import { parentPort } from 'node:worker_threads'
import { mulberry32 } from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { actionFor } from './bot-service.js'
import type { ThinkRequest } from './bot-thinker.js'

// The worker behind `workerRiverThinker`: one river-solving OG, kept for the
// worker's life so a spot solved once is a lookup afterwards.
const solver = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)

parentPort?.on('message', (message: ThinkRequest & { readonly id: number }) => {
  let action = null
  try {
    action = actionFor(
      message.view,
      message.playerId,
      message.personality,
      mulberry32(message.seed),
      {
        ...message.options,
        policy: solver.policy,
      },
    )
  } catch {
    action = null
  }
  parentPort?.postMessage({ id: message.id, action })
})
