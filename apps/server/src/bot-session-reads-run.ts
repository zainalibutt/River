import type { BotPolicy } from '@river/engine'
import {
  leakFreeControlPolicy,
  opponentReadPolicy,
  opponentStatsPlugin,
  type ReadRule,
} from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import {
  type ClusteredEstimate,
  clusteredEstimate,
  pairRuns,
  summarisePairs,
} from './bot-session-evaluation.js'

const confirm = process.argv[2] === '--confirm'
const tables = confirm
  ? [...heldOutTables(), ...ordinaryTables()]
  : [...developmentTables(), ...ordinaryTables()]
const prefix = confirm ? 'b2-confirm' : 'b2-dev'
const round = (value: number) => Math.round(value * 10) / 10
const shown = (estimate: ClusteredEstimate) =>
  `${round(estimate.bigBlindsPer100)} [${estimate.interval95.map(round).join(', ')}]`
const EARLY_HANDS = 10
// Predeclared in the roadmap (packet B2) before any confirmation seed ran.
const GATE = { maximumEarlyReadShare: 0.001, nonInferiorityBigBlinds: -2 } as const

const pooled: { session: number; value: number }[] = []
let clusters = 0
const started = Date.now()
const report = tables.map((table) => {
  const size = campaignSize(table)
  const common = {
    seed: `${prefix}-${table.name}`,
    ...size,
    table,
    focalPersonalities: focalRotation(),
  }
  let current = { session: 0, hand: 0 }
  const reads: { session: number; hand: number; rule: ReadRule }[] = []
  const decisions = { early: 0, later: 0 }
  const reader = opponentReadPolicy({ onRead: (rule) => reads.push({ ...current, rule }) })
  const counted: BotPolicy = {
    id: reader.id,
    version: reader.version,
    decide(context) {
      decisions[current.hand < EARLY_HANDS ? 'early' : 'later'] += 1
      return reader.decide(context)
    },
  }
  const control = runSessions({ ...common, focalPolicy: leakFreeControlPolicy })
  const candidate = runSessions({
    ...common,
    focalPolicy: counted,
    plugin: opponentStatsPlugin(),
    onFocalHand: (session, hand) => {
      current = { session, hand }
    },
  })
  const learning = summarisePairs({
    sessions: size.sessions,
    pairs: pairRuns(control.hands, candidate.hands),
    evidence: [],
  })
  for (const pair of pairRuns(control.hands, candidate.hands)) {
    pooled.push({ session: clusters + pair.session, value: pair.deltaChips })
  }
  clusters += size.sessions
  const live = confirm ? runSessions({ ...common, focalPolicy: pokerGuardPolicy }) : null
  const versusLive =
    live === null
      ? null
      : {
          controlMinusLive: shown(
            summarisePairs({
              sessions: size.sessions,
              pairs: pairRuns(live.hands, control.hands),
              evidence: [],
            }).delta,
          ),
          candidateMinusLive: shown(
            summarisePairs({
              sessions: size.sessions,
              pairs: pairRuns(live.hands, candidate.hands),
              evidence: [],
            }).delta,
          ),
        }
  const byRule = Object.fromEntries(
    (['bluff-catch', 'fold-equity-bluff', 'station-value'] as const).map((rule) => [
      rule,
      reads.filter((read) => read.rule === rule).length,
    ]),
  )
  const earlyReads = reads.filter((read) => read.hand < EARLY_HANDS).length
  return {
    table: table.name,
    candidateMinusControl: shown(learning.delta),
    lowerBound: round(learning.delta.interval95[0]),
    changedHands: learning.changedHands,
    hands: learning.delta.hands,
    reads: byRule,
    earlyReadShare: decisions.early === 0 ? 0 : earlyReads / decisions.early,
    laterReadShare: decisions.later === 0 ? 0 : (reads.length - earlyReads) / decisions.later,
    ...(versusLive ?? {}),
    slices: learning.slices
      .filter((slice) => slice.delta.bigBlindsPer100 !== 0)
      .map((slice) => `${slice.dimension}:${slice.value} ${shown(slice.delta)}`),
  }
})

const all = clusteredEstimate(pooled, clusters)
const gates = {
  earlySessions: report.every((table) => table.earlyReadShare <= GATE.maximumEarlyReadShare),
  nonInferiority: report.every((table) => table.lowerBound >= GATE.nonInferiorityBigBlinds),
  valueOfReading: all.interval95[0] > 0,
}
process.stdout.write(
  `${JSON.stringify(
    {
      mode: confirm ? 'confirm' : 'dev',
      tables: report,
      pooledCandidateMinusControl: shown(all),
      pooledLowerBound: all.interval95[0],
      gates,
    },
    null,
    1,
  )}\n`,
)
process.stderr.write(`finished in ${Math.round((Date.now() - started) / 1000)} s\n`)
