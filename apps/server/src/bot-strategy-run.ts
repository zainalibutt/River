import { type BotPolicy, LEGACY_RULE_STRATEGY, rulePolicy } from '@river/engine'
import { leakFreeControlPolicy } from './bot-opponent-reads.js'
import { guardedPolicy, legacyGuardPolicy } from './bot-poker-guard.js'
import { runSessions, type SessionHandResult } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { type ClusteredEstimate, clusteredEstimate, pairRuns } from './bot-session-evaluation.js'

const variant = (id: string, strategy: Partial<typeof LEGACY_RULE_STRATEGY>): BotPolicy =>
  guardedPolicy(rulePolicy(`${id}-rule`, 1, { ...LEGACY_RULE_STRATEGY, ...strategy }), id, 1)

const VARIANTS: readonly { readonly name: string; readonly policy: BotPolicy }[] = [
  { name: 'live', policy: legacyGuardPolicy },
  { name: 'no-bluff-raise', policy: leakFreeControlPolicy },
  { name: 'never-raise', policy: variant('b3-never', { bluffRaises: 'never' }) },
  { name: 'skilled-bluffs', policy: variant('b3-skilled', { bluffRaises: 'with-equity' }) },
  {
    name: 'ranked-preflop',
    policy: variant('b3-ranked', { bluffRaises: 'never', preflopRanking: true }),
  },
  {
    name: 'checked-bluffs',
    policy: variant('b3-checked', {
      bluffRaises: 'never',
      preflopRanking: true,
      checkedBluffs: true,
    }),
  },
]

const confirm = process.argv[2] === '--confirm'
const tables = confirm
  ? [...heldOutTables(), ...ordinaryTables()]
  : [...developmentTables(), ...ordinaryTables()]
const prefix = confirm ? 'b3-confirm' : 'b3-dev'
// Set after development and before the confirmation run; see the roadmap, packet B3.
const CONFIRM_BUNDLE = 'ranked-preflop'
const GATE = { tableLowerBound: -2 } as const
const comparisons: readonly [string, string][] = confirm
  ? [['live', CONFIRM_BUNDLE]]
  : [
      ['no-bluff-raise', 'never-raise'],
      ['never-raise', 'ranked-preflop'],
      ['ranked-preflop', 'checked-bluffs'],
      ['live', 'ranked-preflop'],
    ]

const needed = new Set(comparisons.flat())
const played = VARIANTS.filter((variant) => needed.has(variant.name))
const round = (value: number) => Math.round(value * 10) / 10
const shown = (estimate: ClusteredEstimate) =>
  `${round(estimate.bigBlindsPer100)} [${estimate.interval95.map(round).join(', ')}]`
const pooled = new Map(
  comparisons.map(([from, to]) => [`${to} - ${from}`, [] as { session: number; value: number }[]]),
)
let clusters = 0
const started = Date.now()

const report = tables.map((table) => {
  const size = campaignSize(table)
  const runs = new Map<string, readonly SessionHandResult[]>()
  for (const { name, policy } of played) {
    runs.set(
      name,
      runSessions({
        seed: `${prefix}-${table.name}`,
        ...size,
        table,
        focalPolicy: policy,
        focalPersonalities: focalRotation(),
      }).hands,
    )
  }
  const rows: Record<string, string> = {}
  let lowest = Number.POSITIVE_INFINITY
  for (const [from, to] of comparisons) {
    const pairs = pairRuns(runs.get(from) ?? [], runs.get(to) ?? [])
    const estimate = clusteredEstimate(
      pairs.map((pair) => ({ session: pair.session, value: pair.deltaChips })),
      size.sessions,
    )
    rows[`${to} - ${from}`] = shown(estimate)
    lowest = Math.min(lowest, estimate.interval95[0])
    pooled
      .get(`${to} - ${from}`)
      ?.push(...pairs.map((pair) => ({ session: clusters + pair.session, value: pair.deltaChips })))
  }
  clusters += size.sessions
  return { table: table.name, ...rows, ...(confirm ? { lowerBound: round(lowest) } : {}) }
})

const totals = Object.fromEntries(
  [...pooled].map(([name, rows]) => [name, shown(clusteredEstimate(rows, clusters))]),
)
const gates = confirm
  ? {
      everyTable: report.every((row) => (row.lowerBound ?? 0) >= GATE.tableLowerBound),
      pooled:
        clusteredEstimate(pooled.get(`${CONFIRM_BUNDLE} - live`) ?? [], clusters).interval95[0] > 0,
    }
  : undefined
process.stdout.write(
  `${JSON.stringify({ mode: prefix, tables: report, pooled: totals, gates }, null, 1)}\n`,
)
process.stderr.write(`finished in ${Math.round((Date.now() - started) / 1000)} s\n`)
