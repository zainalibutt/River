import type { BotPolicy } from '@river/engine'
import { legacyGuardPolicy as pokerGuardPolicy } from './bot-poker-guard.js'
import { handClassOf, runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  focalRotation,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import {
  type ClusteredEstimate,
  runPairedSessions,
  summariseEvidenceYield,
  summarisePairs,
  summariseRun,
} from './bot-session-evaluation.js'

const mode = process.argv[2] ?? '--baseline'
const round = (value: number) => Math.round(value * 10) / 10
const shown = (estimate: ClusteredEstimate) => ({
  hands: estimate.hands,
  bbPer100: round(estimate.bigBlindsPer100),
  interval95: estimate.interval95.map(round),
})

const renamedGuard: BotPolicy = {
  id: 'poker-guard-copy',
  version: 1,
  decide(context) {
    return { ...pokerGuardPolicy.decide(context), policyId: this.id, policyVersion: this.version }
  },
}

const plantedPremiumFold: BotPolicy = {
  id: 'planted-premium-fold',
  version: 1,
  decide(context) {
    const envelope = pokerGuardPolicy.decide(context)
    const { observation } = context
    const leak =
      observation.street === 'preflop' &&
      observation.amountToCall > 0 &&
      observation.legal.fold &&
      handClassOf(observation.actor.hole) === 'premium'
    return {
      ...envelope,
      policyId: this.id,
      policyVersion: this.version,
      decision: leak ? { kind: 'fold' } : envelope.decision,
    }
  },
}

const started = Date.now()
if (mode === '--timing') {
  for (const table of ordinaryTables()) {
    const begin = Date.now()
    runSessions({
      seed: 'b1-timing',
      sessions: 2,
      handsPerSession: 50,
      table,
      focalPolicy: pokerGuardPolicy,
      focalPersonalities: focalRotation(),
    })
    process.stdout.write(`${table.name}: ${(Date.now() - begin) / 100} ms per hand\n`)
  }
} else if (mode === '--instrument') {
  const nine = ordinaryTables()[1]
  if (nine === undefined) throw new Error('ordinary nine-seat table missing')
  const report = [
    ['a-a', renamedGuard],
    ['planted-premium-fold', plantedPremiumFold],
  ].map(([name, candidate]) => {
    const result = runPairedSessions({
      seed: `b1-instrument-${name as string}`,
      ...campaignSize(nine),
      table: nine,
      focalPersonalities: focalRotation(),
      baseline: pokerGuardPolicy,
      candidate: candidate as BotPolicy,
    })
    const summary = summarisePairs(result)
    return {
      check: name,
      changedHands: summary.changedHands,
      delta: shown(summary.delta),
      slices: summary.slices.map((slice) => ({
        slice: `${slice.dimension}:${slice.value}`,
        delta: shown(slice.delta),
      })),
    }
  })
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`)
} else {
  const report = [...heldOutTables(), ...ordinaryTables()].map((table) => {
    const size = campaignSize(table)
    const result = runSessions({
      seed: `b1-baseline-${table.name}`,
      ...size,
      table,
      focalPolicy: pokerGuardPolicy,
      focalPersonalities: focalRotation(),
    })
    const summary = summariseRun(result.hands, size.sessions)
    const evidence = summariseEvidenceYield(result.evidence).perOpponentSession
    return {
      table: table.name,
      style: table.style,
      ...size,
      focal: shown(summary.overall),
      slices: summary.slices.map((slice) => ({
        slice: `${slice.dimension}:${slice.value}`,
        ...shown(slice.estimate),
      })),
      evidencePerOpponentSession: Object.fromEntries(
        Object.entries(evidence).map(([name, value]) => [
          name,
          { mean: round(value.mean), minimum: value.minimum, maximum: value.maximum },
        ]),
      ),
    }
  })
  process.stdout.write(`${JSON.stringify(report, null, 1)}\n`)
}
process.stderr.write(`finished in ${Math.round((Date.now() - started) / 1000)} s\n`)
