import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BotObservationV1,
  type BotPersonality,
  mulberry32,
  personalityPool,
  seedFromString,
} from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { releasePolicyHand } from './bot-policy-hand.js'
import { actionFor, botPlayerId, observationFor, profileFor } from './bot-service.js'
import { openSessionHand } from './bot-session-benchmark.js'
import {
  loadTurnResidualNetwork,
  TURN_RESIDUAL_INPUTS,
  turnResidualLeaf,
} from './bot-turn-residual.js'
import type { LeafProfile } from './bot-turn-river-leaves.js'
import { v9gPolicy } from './bot-v9g-policy.js'
import {
  bucketInputs,
  bucketsFromRanks,
  forwardBatch,
  loadValueNetwork,
} from './bot-value-network.js'
import {
  closeValueNetworkWorkers,
  valueNetworkBackend,
  valueNetworkThreads,
} from './bot-value-simd.js'

const outputRoot = 'art/out/d8-flop-decisions'
const teacherStem = 'art/out/d8-data-scale/frozen/residual-0'
export const leafStems = {
  plain: `${teacherStem}-bucket`,
  h32: 'art/out/d8-distill/h32/residual-0',
  h32x2: 'art/out/d8-distill/h32x2/residual-0',
  teacher: teacherStem,
} as const

interface Fixture {
  seed: string
  source: string
  spots: { hand: number; personality: BotPersonality; observation: BotObservationV1 }[]
}

interface Sample {
  index: number
  decisionMs: number
  leafMs: number
  calls: number
  queries: number
  forwardCalls?: number
  expensive: LeafProfile
  early: LeafProfile
  actions: readonly string[]
  probabilities: number[]
}

interface Batch {
  variant: string
  fixtureSHA256: string
  samples: Sample[]
}

function save(path: string, value: unknown) {
  const rel = relative(process.cwd(), resolve(path))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('output outside worktree')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** Same seeded room/OG cast/guard reference as bot-live-readiness, no external play. */
export function captureFlops(count = 30): Fixture {
  const seed = 'live-readiness-2026-10-25'
  const cast = personalityPool()
    .filter((p) => p.skill === 'og')
    .slice(0, 2)
  const ids = cast.map((p) => botPlayerId(p.id))
  const entrants = cast.map((personality) => ({ personality }))
  const spots: Fixture['spots'] = []
  for (let hand = 0; hand < 1000 && spots.length < count; hand++) {
    const { room } = openSessionHand(seed, 0, hand, 0, entrants, ids)
    const rng = mulberry32(seedFromString(`${seed}:${hand}:actions`))
    for (let step = 0; step < 300; step++) {
      const publicView = room.viewFor('')
      if (publicView.phase !== 'hand') break
      const actor = publicView.currentActor?.playerId
      const personality = cast[ids.indexOf(actor ?? '')]
      if (!actor || !personality) throw new Error('missing actor')
      const view = room.viewFor(actor)
      const observation = observationFor(view, actor, undefined, room.id, room.currentActions())
      if (
        observation?.street === 'flop' &&
        observation.seats.filter((s) => !s.folded).length === 2
      ) {
        spots.push({ hand, personality, observation })
        break // First flop decision per hand; independent boards, no selection by runtime.
      }
      const action = actionFor(view, actor, personality, rng, {
        roomId: room.id,
        publicActions: room.currentActions(),
        policy: pokerGuardPolicy,
      })
      if (!action || !room.submit({ kind: 'act', playerId: actor, action }).ok)
        throw new Error('guard returned invalid action')
    }
  }
  if (spots.length !== count) throw new Error('insufficient flops')
  return {
    seed,
    source: 'bot-live-readiness seeded rooms, two OGs, guard preflop; first flop decision per hand',
    spots,
  }
}

export function quantiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? 0
  return {
    p50: q(0.5),
    p95: q(0.95),
    max: q(1),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  }
}

export function totalVariation(a: readonly number[], b: readonly number[]) {
  if (a.length !== b.length) throw new Error('root actions changed')
  return a.reduce((sum, p, i) => sum + Math.abs(p - (b[i] as number)), 0) / 2
}

async function main() {
  const [variant = 'capture', firstText = '0', countText = '30'] = process.argv.slice(2)
  const fixturePath = `${outputRoot}/spots.json`
  if (variant === 'capture') {
    const fixture = captureFlops()
    save(fixturePath, fixture)
    console.log(JSON.stringify({ spots: fixture.spots.length, file: fixturePath }))
    return
  }
  if (variant === 'summarize') {
    const variants = [
      'plain',
      'h32',
      'h32x2',
      'teacher',
      'teacher-k5',
      'teacher-k10',
      'teacher-k20',
    ]
    const batches = readdirSync(outputRoot)
      .filter((p) =>
        /^(plain|h32|h32x2|teacher|teacher-k5|teacher-k10|teacher-k20)-\d+\.json$/.test(p),
      )
      .map((p) => JSON.parse(readFileSync(`${outputRoot}/${p}`, 'utf8')) as Batch)
    const hashes = new Set(batches.map((b) => b.fixtureSHA256))
    if (hashes.size !== 1) throw new Error('fixture changed across batches')
    const all = new Map(
      variants.map((v) => [v, batches.filter((b) => b.variant === v).flatMap((b) => b.samples)]),
    )
    const teacher = new Map(all.get('teacher')?.map((s) => [s.index, s]))
    const summarize = (v: string, samples: Sample[]) => {
      if (new Set(samples.map((s) => s.index)).size !== samples.length)
        throw new Error(`overlapping batches for ${v}`)
      const pairs = samples.filter((s) => teacher.has(s.index))
      for (const s of pairs)
        if (JSON.stringify(s.actions) !== JSON.stringify(teacher.get(s.index)?.actions))
          throw new Error('actions changed across variants')
      const decision = quantiles(samples.map((s) => s.decisionMs))
      const totalMs = samples.reduce((sum, s) => sum + s.decisionMs, 0)
      return {
        variant: v,
        n: samples.length,
        decisionMs: decision,
        calls: quantiles(samples.map((s) => s.calls)),
        queries: quantiles(samples.map((s) => s.queries)),
        forwardCalls: quantiles(
          samples.map(
            (s) => s.forwardCalls ?? s.expensive.calls * (v === 'plain' ? 1 : 2) + s.early.calls,
          ),
        ),
        leafShare: samples.reduce((sum, s) => sum + s.leafMs, 0) / totalMs,
        pairedTeacherSpots: pairs.length,
        meanRootTV: pairs.length
          ? pairs.reduce(
              (sum, s) =>
                sum + totalVariation(s.probabilities, teacher.get(s.index)?.probabilities ?? []),
              0,
            ) / pairs.length
          : null,
        over8s: samples.filter((s) => s.decisionMs > 8000).length,
        marginAtP95Ms: 8000 - decision.p95,
      }
    }
    const summary = variants.map((v) => summarize(v, all.get(v) ?? []))
    const commonIndices = (all.get('plain') ?? [])
      .map((s) => s.index)
      .filter((index) => variants.every((v) => all.get(v)?.some((s) => s.index === index)))
    const commonSummary = variants.map((v) =>
      summarize(
        v,
        (all.get(v) ?? []).filter((s) => commonIndices.includes(s.index)),
      ),
    )
    save(`${outputRoot}/summary.json`, {
      fixtureSHA256: [...hashes][0],
      complete: summary.every((s) => s.n === 30),
      summary,
      commonIndices,
      commonSummary,
    })
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  const lastIterations = variant.startsWith('teacher-k') ? Number(variant.slice(9)) : undefined
  if (!(variant in leafStems) && ![5, 10, 20].includes(lastIterations ?? -1))
    throw new Error('variant: plain|h32|h32x2|teacher|teacher-k5|teacher-k10|teacher-k20')
  const first = Number(firstText),
    count = Number(countText)
  if (
    !Number.isSafeInteger(first) ||
    first < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    first + count > 30
  )
    throw new Error('invalid slice')
  const raw = readFileSync(fixturePath)
  const fixture: Fixture = JSON.parse(raw.toString())
  const fixtureSHA256 = createHash('sha256').update(raw).digest('hex')
  process.env.RIVER_VALUE_BACKEND = 'wasm'
  // Only one inference worker may exist. Residual bucket calls have batch=1:
  // initialise them with one participant; the head uses main + one worker.
  process.env.RIVER_VALUE_THREADS = variant === 'plain' ? '2' : '1'
  const model =
    variant === 'plain'
      ? undefined
      : loadTurnResidualNetwork(
          leafStems[
            lastIterations === undefined
              ? (variant as Exclude<keyof typeof leafStems, 'plain'>)
              : 'teacher'
          ],
        )
  const bucket = model?.bucket ?? loadValueNetwork(leafStems.plain)
  const dummyRanks = new Uint16Array(1326).fill(1)
  const layout = bucketsFromRanks(dummyRanks, 128)
  forwardBatch(
    bucket,
    bucketInputs(
      layout,
      [new Float64Array(1326).fill(1), new Float64Array(1326).fill(1)],
      100,
      100,
    ),
    1,
    bucket.layers.map((l) => new Float32Array(l.rows)),
  )
  process.env.RIVER_VALUE_THREADS = '2'
  if (model) {
    // Warm the worker and WASM buffers, excluding model load/JIT from samples.
    forwardBatch(
      model.residual,
      new Float32Array(2256 * TURN_RESIDUAL_INPUTS),
      2256,
      model.residual.layers.map((l) => new Float32Array(2256 * l.rows)),
    )
  }
  process.env.RIVER_FLOP_NETWORK = leafStems.plain // Required even with shared weights.
  const leaf = model ? turnResidualLeaf(model) : bucket
  const profile: LeafProfile = { calls: 0, queries: 0, ms: 0 }
  const earlyProfile: LeafProfile = { calls: 0, queries: 0, ms: 0 }
  const samples = []
  const started = performance.now()
  try {
    for (let index = first; index < first + count; index++) {
      if (performance.now() - started > 780_000) throw new Error('13 minute batch limit')
      const point = fixture.spots[index]
      if (!point) throw new Error('missing spot')
      profile.calls = profile.queries = profile.ms = 0
      earlyProfile.calls = earlyProfile.queries = earlyProfile.ms = 0
      // These street weights are unused: this fixture never requests turn/river
      // actions. Assert that below; use the exact trained turn-start bucket.
      const chain = v9gPolicy(
        {
          offTree: 'resolve',
          turnStartLeaf: {
            network: leaf,
            profile,
            earlyProfile,
            ...(lastIterations === undefined ? {} : { lastIterations, earlyNetwork: bucket }),
          },
        },
        { turn: bucket, flop: bucket, turnStart: bucket, river: bucket },
      )
      const before = performance.now()
      const result = chain.policy.decide({
        observation: point.observation,
        personality: point.personality,
        profile: profileFor(point.personality),
        tilt: point.observation.tilt,
        rng: mulberry32(index + 1),
      })
      const decisionMs = performance.now() - before
      const explanation = chain.explain(point.observation, point.personality)
      if (
        typeof explanation === 'string' ||
        result.fallbackReason !== null ||
        chain.turn.solves ||
        chain.river.solves ||
        !chain.stats.solves
      )
        throw new Error(
          `unexpected fallback/street: ${JSON.stringify({ result, explanation, stats: chain.stats })}`,
        )
      const sample = {
        index,
        hand: point.hand,
        decisionMs,
        leafMs: profile.ms + earlyProfile.ms,
        calls: profile.calls + earlyProfile.calls,
        queries: profile.queries + earlyProfile.queries,
        forwardCalls: profile.calls * (model ? 2 : 1) + earlyProfile.calls,
        expensive: { ...profile },
        early: { ...earlyProfile },
        history: explanation.history,
        actions: explanation.actions,
        probabilities: explanation.row,
        ranges: explanation.ranges,
        inRange: explanation.inRange,
        solves: chain.stats.solves,
        offTree: chain.stats.offTree,
      }
      samples.push(sample)
      releasePolicyHand(chain.policy, point.observation.roomId, point.observation.handNumber)
      save(`${outputRoot}/${variant}-${first}.json`, {
        variant,
        first,
        count,
        fixtureSHA256,
        backend: valueNetworkBackend(bucket),
        headBackend: model ? valueNetworkBackend(model.residual) : null,
        cpu: cpus()[0]?.model,
        models: model
          ? {
              bucket: `${lastIterations === undefined ? leafStems[variant as Exclude<keyof typeof leafStems, 'plain'>] : teacherStem}-bucket`,
              head: `${lastIterations === undefined ? leafStems[variant as Exclude<keyof typeof leafStems, 'plain'>] : teacherStem}-head`,
            }
          : { bucket: leafStems.plain },
        bucketThreads: valueNetworkThreads(bucket),
        headThreads: model ? valueNetworkThreads(model.residual) : null,
        iterations: 40,
        outputPruning: 'exact traverser-only residual rows; both ranges retained in features',
        samples,
        timing: quantiles(samples.map((s) => s.decisionMs)),
      })
      console.log(
        JSON.stringify({
          variant,
          index,
          ms: Math.round(decisionMs),
          calls: sample.calls,
          queries: sample.queries,
        }),
      )
    }
  } finally {
    closeValueNetworkWorkers(bucket)
    if (model) closeValueNetworkWorkers(model.residual)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
