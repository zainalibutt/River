import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { personalityPool } from '@river/engine'
import { expect, it, vi } from 'vitest'
import * as carryModule from './bot-river-carry.js'
import { runSessions } from './bot-session-benchmark.js'
import { solvedFlopPolicy } from './bot-turn-policy.js'
import type { RiverValueNetwork } from './bot-value-network.js'

const network: RiverValueNetwork = {
  buckets: 1,
  layers: [
    {
      rows: 2,
      columns: 4,
      slope: null,
      weight: new Float32Array(8),
      bias: Float32Array.of(0.5, 0.5),
    },
  ],
}

it('matches pre-release v9g decisions, carried promises and carry counts on 30 fixed deals', () => {
  const chain = solvedFlopPolicy(network, network, {
    carry: 'both',
    scheme: 'dcfr',
    iterations: 40,
    turnStartNetwork: network,
    riverNetwork: network,
  })
  const hash = createHash('sha256')
  let carries = 0
  const original = carryModule.carryFromRecord
  const spy = vi.spyOn(carryModule, 'carryFromRecord').mockImplementation((...args) => {
    const result = original(...args)
    hash.update(JSON.stringify(result))
    carries += 1
    // Do not let the spy itself retain promise arrays throughout the run.
    spy.mockClear()
    return result
  })
  const cast = personalityPool()
  const focal = cast[10]
  const opponent = cast[0]
  if (!focal || !opponent) throw new Error('missing cast')
  try {
    const result = runSessions({
      seed: 'v9g-memory-regression',
      sessions: 2,
      handsPerSession: 15,
      table: {
        name: 'heads-up',
        style: 'plain',
        entrants: [{ personality: focal }, { personality: opponent }],
      },
      focalPolicy: {
        ...chain.policy,
        decide(context) {
          const answer = chain.policy.decide(context)
          hash.update(JSON.stringify(answer.decision))
          return answer
        },
      },
    })
    const actual = {
      hash: hash.digest('hex'),
      carries,
      deck: result.hands.map((hand) => hand.commit),
      stats: [chain.stats, chain.turn, chain.river].map(
        ({ solves, solved, carryUsed, carryFallbacks, fallbacks }) => ({
          solves,
          solved,
          carryUsed,
          carryFallbacks,
          fallbacks,
        }),
      ),
    }
    expect(carries).toBeGreaterThan(0)
    const fixture = new URL('./bot-policy-memory.fixture.json', import.meta.url)
    if (process.env.UPDATE_V9G_MEMORY_GOLDEN === '1')
      writeFileSync(fixture, `${JSON.stringify(actual, null, 2)}\n`)
    expect(actual).toEqual(JSON.parse(readFileSync(fixture, 'utf8')))
  } finally {
    spy.mockRestore()
  }
}, 1_800_000)
