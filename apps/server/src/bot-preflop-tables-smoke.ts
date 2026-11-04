import { writeFileSync } from 'node:fs'
import { type BotPolicy, championPersonality, personalityPool } from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { releasePolicyHand } from './bot-policy-hand.js'
import { tablePreflopPolicy, tableRow, tracePreflop } from './bot-preflop-tables.js'
import { publicDecisions } from './bot-public-replay.js'
import { runSessions } from './bot-session-benchmark.js'
import { v9gPolicy } from './bot-v9g-policy.js'

// tsx apps/server/src/bot-preflop-tables-smoke.ts <out.json> [hands=200] [seed]
const [out, handText = '200', seed = 'v9gp-local-20261024'] = process.argv.slice(2)
const hands = Number(handText)
if (!out || !Number.isSafeInteger(hands) || hands < 2 || hands % 2 !== 0)
  throw new Error('usage: <out.json> [hands=200] [seed]')
const chain = v9gPolicy({ offTree: 'resolve', preflopTables: true })
const opponent = tablePreflopPolicy(pokerGuardPolicy)
const groups: Record<string, { n: number; counts: number[]; expected: number[] }> = {}
const policy: BotPolicy = {
  ...chain.policy,
  decide(context) {
    const result = chain.policy.decide(context)
    const { observation } = context
    if (observation.street !== 'preflop') return result
    const history = publicDecisions(observation)
    const trace = history && tracePreflop(observation, history)
    if (!trace || typeof trace === 'string' || trace.node.kind !== 'decision')
      throw new Error('smoke history missing')
    const id = trace.node.id
    const name =
      id === 'button'
        ? 'button: fold/limp/open'
        : id === 'button/raise-2.5'
          ? 'BB vs open: fold/call/3bet'
          : id === 'button/limp'
            ? 'BB vs limp: check/raise'
            : null
    if (name) {
      const n = id === 'button/limp' ? 2 : 3
      const group = groups[name] ?? { n: 0, counts: Array(n).fill(0), expected: Array(n).fill(0) }
      groups[name] = group
      group.n++
      const action = result.decision
      const bucket =
        n === 2
          ? action.kind === 'check'
            ? 0
            : 1
          : action.kind === 'fold'
            ? 0
            : action.kind === 'call' || action.kind === 'check'
              ? 1
              : 2
      group.counts[bucket] = (group.counts[bucket] as number) + 1
      tableRow(trace.pack, trace.node, observation.actor.hole).forEach((p, k) => {
        const bucket = n === 2 ? Math.min(k, 1) : Math.min(k, 2)
        group.expected[bucket] = (group.expected[bucket] as number) + p
      })
    }
    return result
  },
}
// Preserve the chain's settlement callback through the instrumentation wrapper.
Object.assign(policy, {
  releaseHand: (roomId: string, handNumber: number) =>
    releasePolicyHand(chain.policy, roomId, handNumber),
})
const other = personalityPool().find((p) => p.id !== championPersonality().id)
if (!other) throw new Error('missing opponent')
const started = Date.now()
const run = runSessions({
  seed,
  sessions: 2,
  handsPerSession: hands / 2,
  focalPolicy: policy,
  focalPersonalities: [championPersonality()],
  table: {
    name: 'v9gp-hu-tables',
    style: 'plain',
    entrants: [
      { personality: championPersonality() },
      { personality: other, policy: opponent.policy },
    ],
  },
  onFocalHand: (_, hand) => {
    if (hand % 10 === 0) process.stderr.write(`v9gp local: ${hand}/${hands}\n`)
  },
})
const report = {
  hands: run.hands.length,
  seconds: (Date.now() - started) / 1000,
  chips: run.hands.reduce((sum, h) => sum + h.focalChips, 0),
  groups: Object.fromEntries(
    Object.entries(groups).map(([name, g]) => [
      name,
      {
        ...g,
        frequencies: g.counts.map((v) => v / g.n),
        tableExpected: g.expected.map((v) => v / g.n),
      },
    ]),
  ),
  preflop: chain.preflop,
  flop: chain.stats,
  turn: chain.turn,
  river: chain.river,
}
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(report)}\n`)
