// Usage: node --expose-gc --import tsx apps/server/src/bot-policy-memory-run.ts [hands] [out.json]
// Set the four RIVER_*_NETWORK export stems exactly as for bot-compare-table v9g.
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { personalityPool } from '@river/engine'
import { flopTurnLayoutMemory } from './bot-flop-turn-leaves.js'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { runSessions } from './bot-session-benchmark.js'
import { solvedFlopPolicy } from './bot-turn-policy.js'
import {
  loadValueNetwork,
  riverNetworkFromEnvironment,
  turnNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'
import { valueNetworkMemory } from './bot-value-simd.js'

const hands = Number(process.argv[2] ?? 200)
const out = process.argv[3]
if (!Number.isSafeInteger(hands) || hands < 2 || hands % 2 !== 0)
  throw new Error('hands must be positive and even')
const flopStem = process.env.RIVER_FLOP_NETWORK
if (!flopStem) throw new Error('set RIVER_FLOP_NETWORK')
const networks = [
  turnNetworkFromEnvironment(),
  loadValueNetwork(flopStem),
  turnStartNetworkFromEnvironment(),
  riverNetworkFromEnvironment(),
] as const
const chain = solvedFlopPolicy(networks[0], networks[1], {
  carry: 'both',
  scheme: 'dcfr',
  iterations: 40,
  turnStartNetwork: networks[2],
  riverNetwork: networks[3],
})
const cast = personalityPool()
const focal = cast[10]
const opponent = cast[0]
if (!focal || !opponent) throw new Error('missing cast')
const decisions: unknown[] = []
const samples: unknown[] = []
function sample(completed: number) {
  global.gc?.()
  const row = {
    completed,
    memory: process.memoryUsage(),
    caches: chain.caches(),
    layouts: flopTurnLayoutMemory(),
    networks: networks.map(valueNetworkMemory),
  }
  samples.push(row)
  console.log(JSON.stringify(row))
}
sample(0)
const result = runSessions({
  seed: 'v9g-memory-fixed-deck',
  sessions: 2,
  handsPerSession: hands / 2,
  table: {
    name: 'heads-up',
    style: 'plain',
    entrants: [{ personality: focal }, { personality: opponent }],
  },
  plugin: opponentStatsPlugin(),
  focalPolicy: {
    ...chain.policy,
    decide(context) {
      const answer = chain.policy.decide(context)
      decisions.push([context.observation.roomId, context.observation.street, answer.decision])
      return answer
    },
  },
  onFocalHand(session, hand) {
    const completed = session * (hands / 2) + hand
    if (completed > 0 && completed % 20 === 0) sample(completed)
  },
})
sample(result.hands.length)
const report = {
  configuration: {
    node: process.version,
    seed: 'v9g-memory-fixed-deck',
    hands,
    gc: global.gc !== undefined,
    models: Object.fromEntries(
      [
        'RIVER_TURN_NETWORK',
        'RIVER_FLOP_NETWORK',
        'RIVER_TURN_START_NETWORK',
        'RIVER_RIVER_NETWORK',
      ].map((name) => [name, process.env[name]]),
    ),
  },
  samples,
  decisions,
  deck: result.hands.map((hand) => hand.commit),
  decisionHash: createHash('sha256').update(JSON.stringify(decisions)).digest('hex'),
  stats: { flop: chain.stats, turn: chain.turn, river: chain.river },
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ decisionHash: report.decisionHash, stats: report.stats }))
