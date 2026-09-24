import type { BotPolicy } from '@river/engine'
import { opponentReadPolicy, opponentStatsPlugin, type ReadRule } from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { type ClusteredEstimate, clusteredEstimate, pairRuns } from './bot-session-evaluation.js'

const confirm = process.argv[2] === '--confirm'
const tables = confirm
  ? [...heldOutTables(), ...ordinaryTables()]
  : [...developmentTables(), ...ordinaryTables()]
const prefix = confirm ? 'b4-confirm' : 'b4-dev'
const CHAIN = { length: 6, chains: 40 } as const
const EARLY_HANDS = 10
// Predeclared in the roadmap (packet B4) before any confirmation seed ran.
const GATE = { maximumEarlyReads: 0, tableLowerBound: -2 } as const

const round = (value: number) => Math.round(value * 10) / 10
const shown = (estimate: ClusteredEstimate) =>
  `${round(estimate.bigBlindsPer100)} [${estimate.interval95.map(round).join(', ')}]`
const pooled: { session: number; value: number }[] = []
let clusters = 0
const started = Date.now()

const report = tables.map((table) => {
  const hands = campaignSize(table).handsPerSession
  const common = {
    seed: `${prefix}-${table.name}`,
    sessions: CHAIN.length * CHAIN.chains,
    handsPerSession: hands,
    chainLength: CHAIN.length,
    table,
    focalPersonalities: focalRotation(),
  }
  let current = { session: 0, hand: 0 }
  const reads: { encounter: number; hand: number; rule: ReadRule }[] = []
  const reader = opponentReadPolicy({
    base: pokerGuardPolicy,
    onRead: (rule) =>
      reads.push({ encounter: current.session % CHAIN.length, hand: current.hand, rule }),
  })
  const counted: BotPolicy = { id: reader.id, version: reader.version, decide: reader.decide }
  const base = runSessions({ ...common, focalPolicy: pokerGuardPolicy })
  const candidate = runSessions({
    ...common,
    focalPolicy: counted,
    plugin: opponentStatsPlugin(),
    onFocalHand: (session, hand) => {
      current = { session, hand }
    },
  })
  const pairs = pairRuns(base.hands, candidate.hands)
  const byChain = (rows: typeof pairs) =>
    clusteredEstimate(
      rows.map((pair) => ({
        session: Math.floor(pair.session / CHAIN.length),
        value: pair.deltaChips,
      })),
      CHAIN.chains,
    )
  const overall = byChain(pairs)
  for (const pair of pairs) {
    pooled.push({
      session: clusters + Math.floor(pair.session / CHAIN.length),
      value: pair.deltaChips,
    })
  }
  clusters += CHAIN.chains
  return {
    table: table.name,
    candidateMinusBase: shown(overall),
    lowerBound: round(overall.interval95[0]),
    earlyReads: reads.filter((read) => read.encounter === 0 && read.hand < EARLY_HANDS).length,
    byEncounter: Array.from({ length: CHAIN.length }, (_, encounter) => {
      const rows = pairs.filter((pair) => pair.encounter === encounter)
      return `${encounter + 1}: ${shown(byChain(rows))} reads ${reads.filter((read) => read.encounter === encounter).length}`
    }),
    reads: Object.fromEntries(
      (['bluff-catch', 'fold-equity-bluff', 'station-value'] as const).map((rule) => [
        rule,
        reads.filter((read) => read.rule === rule).length,
      ]),
    ),
  }
})

const all = clusteredEstimate(pooled, clusters)
const gates = {
  earlySessions: report.every((row) => row.earlyReads <= GATE.maximumEarlyReads),
  nonInferiority: report.every((row) => row.lowerBound >= GATE.tableLowerBound),
  valueOfReading: all.interval95[0] > 0,
}
process.stdout.write(
  `${JSON.stringify({ mode: prefix, tables: report, pooled: shown(all), pooledLowerBound: all.interval95[0], gates }, null, 1)}\n`,
)
process.stderr.write(`finished in ${Math.round((Date.now() - started) / 1000)} s\n`)
