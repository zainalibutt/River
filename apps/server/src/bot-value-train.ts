import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { blend, mulberry32, seedFromString } from '@river/engine'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { v5GuardPolicy as pokerGuardPolicy } from './bot-poker-guard.js'
import { bucketAction, bucketOf, rolloutValue, type Situation, situationOf } from './bot-rollout.js'
import { profileFor } from './bot-service.js'
import { type FocalDecisionPoint, runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  focalRotation,
  ordinaryTables,
} from './bot-session-campaign.js'
import {
  headsUpOpponent,
  predict,
  type TrainingOptions,
  trainValueNetwork,
  VALUE_FEATURES,
  type ValueExample,
  type ValueModel,
  type ValueNetwork,
  valueFeatures,
} from './bot-value-model.js'

export const VALUE_CAMPAIGN = {
  seedPrefix: 'b5-data',
  sessionsPerTable: 24,
  validationFromSession: 18,
  maximumPointsPerTable: 1_200,
  rolloutsPerBucket: 2,
  margins: [0, 0.05, 0.1, 0.2, 0.3, 0.5],
  training: {
    hidden: 32,
    epochs: 40,
    batch: 64,
    learningRate: 0.003,
    l2: 0.0005,
    huberDelta: 1,
    seed: 20260924,
  } satisfies TrainingOptions,
} as const

interface LabelledPoint extends ValueExample {
  readonly table: string
  readonly session: number
  readonly situation: Situation
  readonly baseBucket: number
}

const ARTIFACT = 'apps/server/models/og-action-value-v1.experimental.json'
const started = Date.now()
const points: LabelledPoint[] = []

for (const table of [...developmentTables(), ...ordinaryTables()]) {
  const captured: { point: FocalDecisionPoint; table: string }[] = []
  runSessions({
    seed: `${VALUE_CAMPAIGN.seedPrefix}-${table.name}`,
    sessions: VALUE_CAMPAIGN.sessionsPerTable,
    handsPerSession: campaignSize(table).handsPerSession,
    table,
    focalPolicy: pokerGuardPolicy,
    focalPersonalities: focalRotation(),
    plugin: opponentStatsPlugin(),
    onFocalDecision: (point) => {
      if (headsUpOpponent(point.observation) !== null) captured.push({ point, table: table.name })
    },
  })
  const stride = Math.max(1, Math.ceil(captured.length / VALUE_CAMPAIGN.maximumPointsPerTable))
  for (let index = 0; index < captured.length; index += stride) {
    const entry = captured[index]
    if (entry === undefined) continue
    const { point } = entry
    const x = valueFeatures(point.observation)
    if (x === null || x.some((value) => !Number.isFinite(value))) continue
    const targets = [0, 1, 2].map((bucket) => {
      const action = bucketAction(point.observation, bucket)
      if (action === null) return null
      let total = 0
      for (let rollout = 0; rollout < VALUE_CAMPAIGN.rolloutsPerBucket; rollout += 1) {
        total += rolloutValue(
          point,
          action,
          pokerGuardPolicy,
          `b5-rollout:${table.name}:${index}:${bucket}:${rollout}`,
        )
      }
      return total / VALUE_CAMPAIGN.rolloutsPerBucket / Math.max(1, point.observation.pot)
    })
    const personality = point.entrants[0]?.personality
    if (personality === undefined) continue
    const tilted = blend(personality, 0)
    const base = pokerGuardPolicy.decide({
      observation: point.observation,
      profile: profileFor(tilted),
      personality: tilted,
      tilt: point.observation.tilt,
      rng: mulberry32(seedFromString(`b5-base:${table.name}:${index}`)),
    }).decision
    points.push({
      table: table.name,
      session: point.session,
      situation: situationOf(point.observation),
      x,
      targets,
      baseBucket: bucketOf(point.observation, base),
    })
  }
  process.stderr.write(
    `${table.name}: ${captured.length} heads-up postflop decisions, kept ${points.filter((p) => p.table === table.name).length}\n`,
  )
}

const report: Record<string, unknown> = {}
const networks: Partial<Record<Situation, ValueNetwork>> = {}
const margins: Partial<Record<Situation, number>> = {}
for (const situation of ['facing', 'free'] as const) {
  const all = points.filter((point) => point.situation === situation)
  const training = all.filter((point) => point.session < VALUE_CAMPAIGN.validationFromSession)
  const validation = all.filter((point) => point.session >= VALUE_CAMPAIGN.validationFromSession)
  const network = trainValueNetwork(training, VALUE_CAMPAIGN.training)
  networks[situation] = network
  const bucketMeans = [0, 1, 2].map((bucket) => {
    const values = training.flatMap((point) => {
      const target = point.targets[bucket]
      return target === null || target === undefined ? [] : [target]
    })
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  })
  const huber = (error: number) =>
    Math.abs(error) <= 1 ? 0.5 * error * error : Math.abs(error) - 0.5
  const loss = (predictor: (point: LabelledPoint) => number[]) => {
    let total = 0
    let count = 0
    for (const point of validation) {
      const predicted = predictor(point)
      point.targets.forEach((target, bucket) => {
        if (target === null) return
        total += huber((predicted[bucket] ?? 0) - target)
        count += 1
      })
    }
    return total / Math.max(1, count)
  }
  const gainAt = (margin: number) => {
    const gains = validation.map((point) => {
      const values = predict(network, point.x)
      let best = point.baseBucket
      point.targets.forEach((target, bucket) => {
        if (target !== null && (values[bucket] ?? 0) > (values[best] ?? 0)) best = bucket
      })
      const chosen = point.targets[best]
      const base = point.targets[point.baseBucket]
      if (
        best === point.baseBucket ||
        (values[best] ?? 0) - (values[point.baseBucket] ?? 0) <= margin
      ) {
        return { gain: 0, changed: 0 }
      }
      if (chosen === null || chosen === undefined || base === null || base === undefined) {
        return { gain: 0, changed: 0 }
      }
      return { gain: chosen - base, changed: 1 }
    })
    const mean = gains.reduce((sum, entry) => sum + entry.gain, 0) / Math.max(1, gains.length)
    const variance =
      gains.reduce((sum, entry) => sum + (entry.gain - mean) ** 2, 0) /
      Math.max(1, gains.length - 1)
    return {
      margin,
      meanGainPots: mean,
      interval95: [
        mean - 1.96 * Math.sqrt(variance / gains.length),
        mean + 1.96 * Math.sqrt(variance / gains.length),
      ],
      changedShare:
        gains.reduce((sum, entry) => sum + entry.changed, 0) / Math.max(1, gains.length),
    }
  }
  const byMargin = VALUE_CAMPAIGN.margins.map(gainAt)
  const chosen = byMargin.reduce((best, entry) =>
    (entry.interval95[0] ?? Number.NEGATIVE_INFINITY) >
    (best.interval95[0] ?? Number.NEGATIVE_INFINITY)
      ? entry
      : best,
  )
  margins[situation] = chosen.margin
  report[situation] = {
    training: training.length,
    validation: validation.length,
    validationLoss: {
      model: loss((point) => predict(network, point.x)),
      bucketMean: loss(() => bucketMeans),
    },
    byMargin,
    chosenMargin: chosen.margin,
  }
}

const model: ValueModel & Record<string, unknown> = {
  version: 1,
  features: [...VALUE_FEATURES],
  networks: networks as Record<Situation, ValueNetwork>,
  margins,
  campaign: VALUE_CAMPAIGN,
  provenance:
    'synthetic River development styles and ordinary cast; rollout labels use the dealt cards offline, inputs do not',
  offline: report,
  promotionEligible: false,
  liveInferenceEnabled: false,
}
const text = `${JSON.stringify(model, null, 2)}\n`
if (
  existsSync(ARTIFACT) &&
  JSON.stringify(JSON.parse(readFileSync(ARTIFACT, 'utf8'))) !== JSON.stringify(model) &&
  !process.argv.includes('--replace')
) {
  throw new Error(`${ARTIFACT} exists with different contents; pass --replace to overwrite`)
}
writeFileSync(ARTIFACT, text)
execFileSync('npx', ['biome', 'format', '--write', ARTIFACT], { stdio: 'ignore', shell: true })
process.stdout.write(`${JSON.stringify(report, null, 1)}\n`)
process.stderr.write(
  `points ${points.length}, finished in ${Math.round((Date.now() - started) / 1000)} s\n`,
)
