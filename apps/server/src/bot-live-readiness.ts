import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { mulberry32, personalityPool, seedFromString, type TurnAction } from '@river/engine'
import {
  type LiveSafeBotPolicy,
  type LiveSafeConfig,
  type LiveSafeEvent,
  liveSafeBotPolicy,
  liveSafeConfig,
} from './bot-live-safe.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { actionFor, botPlayerId } from './bot-service.js'
import { openSessionHand } from './bot-session-benchmark.js'

export function latencySummary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null
  return {
    count: sorted.length,
    p50: quantile(0.5),
    p95: quantile(0.95),
    p99: quantile(0.99),
    max: sorted.at(-1) ?? null,
  }
}

export interface ReadinessBatch {
  config: LiveSafeConfig
  seed: string
  firstHand: number
  hands: number
  wallMs: number
  coldStartWallMs: number
  modelLoad: LiveSafeEvent[]
  initialRss: number
  loadedRss: number
  peakRss: number
  finalRss: number
  peakCarryBytes: number
  peakCarryEntries: number
  finalMemory: ReturnType<LiveSafeBotPolicy['diagnostics']>
  stats: LiveSafeBotPolicy['stats']
  rss: { ms: number; hand: number; bytes: number }[]
  decisionSamplesMs: Record<string, number[]>
}

/** Preserve process boundaries and recompute quantiles from individual decisions. */
export function combineReadinessBatches(input: readonly ReadinessBatch[]) {
  const batches = [...input].sort((a, b) => a.firstHand - b.firstHand)
  const first = batches[0]
  if (first === undefined) throw new Error('no readiness batches')
  let next = first.firstHand
  const samples: Record<string, number[]> = {}
  const fallbacks: Record<string, number> = {}
  for (const batch of batches) {
    if (
      batch.firstHand !== next ||
      batch.seed !== first.seed ||
      JSON.stringify(batch.config) !== JSON.stringify(first.config)
    ) {
      throw new Error(
        'batches must have matching configuration and consecutive, nonoverlapping hands',
      )
    }
    if (Object.values(batch.finalMemory).some((count) => count !== 0))
      throw new Error('batch leaked carry records')
    next += batch.hands
    for (const [street, values] of Object.entries(batch.decisionSamplesMs)) {
      samples[street] ??= []
      samples[street].push(...values)
    }
    for (const [reason, count] of Object.entries(batch.stats.fallbacks)) {
      fallbacks[reason] = (fallbacks[reason] ?? 0) + count
    }
  }
  return {
    config: first.config,
    seed: first.seed,
    segmented: true,
    hands: batches.reduce((sum, batch) => sum + batch.hands, 0),
    wallMs: batches.reduce((sum, batch) => sum + batch.wallMs, 0),
    latencyMs: Object.fromEntries(
      Object.entries(samples).map(([street, values]) => [street, latencySummary(values)]),
    ),
    peakRss: Math.max(...batches.map((batch) => batch.peakRss)),
    peakAdditionalRssAfterLoad: Math.max(
      ...batches.map((batch) => batch.peakRss - batch.loadedRss),
    ),
    peakCarryBytes: Math.max(...batches.map((batch) => batch.peakCarryBytes)),
    peakCarryEntries: Math.max(...batches.map((batch) => batch.peakCarryEntries)),
    stats: {
      decisions: batches.reduce((sum, batch) => sum + batch.stats.decisions, 0),
      safeDecisions: batches.reduce((sum, batch) => sum + batch.stats.safeDecisions, 0),
      guardFallbacks: batches.reduce((sum, batch) => sum + batch.stats.guardFallbacks, 0),
      workerStarts: batches.reduce((sum, batch) => sum + batch.stats.workerStarts, 0),
      fallbacks,
    },
    batches: batches.map((batch) => ({
      firstHand: batch.firstHand,
      hands: batch.hands,
      wallMs: batch.wallMs,
      coldStartWallMs: batch.coldStartWallMs,
      modelLoad: batch.modelLoad,
      initialRss: batch.initialRss,
      loadedRss: batch.loadedRss,
      finalRss: batch.finalRss,
      finalMemory: batch.finalMemory,
      rss: batch.rss,
    })),
    decisionSamplesMs: samples,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const value = (key: string, fallback: string) => {
    if (!args.includes(key)) return fallback
    const next = args[args.indexOf(key) + 1]
    if (next === undefined || next.startsWith('--')) throw new Error(`${key} needs a value`)
    return next
  }
  const hands = Number(value('--hands', '100'))
  const firstHand = Number(value('--first-hand', '0'))
  const threads = Number(value('--threads', '2'))
  const budgetMs = Number(value('--budget-ms', '8000'))
  const variant = value('--variant', 'v9go')
  const seed = value('--seed', 'live-readiness-2026-10-25')
  if (
    !Number.isSafeInteger(hands) ||
    hands < 1 ||
    hands > 10_000 ||
    !Number.isSafeInteger(firstHand) ||
    firstHand < 0 ||
    ![1, 2, 4].includes(threads) ||
    !Number.isFinite(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 8000 ||
    !['v9go', 'v9gp'].includes(variant)
  )
    throw new Error('invalid hands, threads, budget-ms or variant')
  const output = resolve(value('--out', 'out/bot-live-readiness.json'))
  const local = relative(process.cwd(), output)
  if (local.startsWith('..') || isAbsolute(local))
    throw new Error('--out must be inside the worktree')
  if (args.includes('--merge')) {
    const start = args.indexOf('--merge') + 1
    const end = args.findIndex((arg, index) => index >= start && arg.startsWith('--'))
    const files = args.slice(start, end === -1 ? undefined : end)
    const merged = combineReadinessBatches(
      files.map((file) => JSON.parse(readFileSync(file, 'utf8')) as ReadinessBatch),
    )
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`)
    console.log(
      JSON.stringify(
        {
          ...merged,
          batches: `${files.length} batches in ${output}`,
          decisionSamplesMs: undefined,
        },
        null,
        2,
      ),
    )
    return
  }
  const config = {
    ...liveSafeConfig(),
    enabled: true,
    variant: variant as 'v9go' | 'v9gp',
    threads,
    budgetMs,
  }
  const latencies: Record<string, number[]> = {}
  const events: LiveSafeEvent[] = []
  const rss: { ms: number; hand: number; bytes: number }[] = []
  const started = performance.now()
  let completed = 0
  let peakCarryBytes = 0
  let peakCarryEntries = 0
  const sample = () => {
    rss.push({ ms: performance.now() - started, hand: completed, bytes: process.memoryUsage().rss })
    peakCarryBytes = Math.max(peakCarryBytes, policy.diagnostics().bytes)
    peakCarryEntries = Math.max(peakCarryEntries, policy.diagnostics().entries)
  }
  const policy = liveSafeBotPolicy(config, {
    execArgv: import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : [],
    onEvent: (event) => {
      if (event.type === 'ready') events.push(event)
      if (event.type === 'decision') {
        const street = event.street ?? 'unknown'
        latencies[street] ??= []
        latencies[street].push(event.ms ?? 0)
      }
    },
  })
  sample()
  const initialRss = process.memoryUsage().rss
  const sampling = setInterval(sample, 250)
  const watchdog = setTimeout(() => {
    void policy.close()
  }, 540_000)
  let report: object | undefined
  try {
    const loading = performance.now()
    await policy.ready()
    const coldStartWallMs = performance.now() - loading
    if (events.some((event) => event.modelError !== undefined) || events.length !== threads) {
      throw new Error(`model workers did not load: ${JSON.stringify(events)}`)
    }
    const loadedRss = process.memoryUsage().rss
    const cast = personalityPool()
      .filter((person) => person.skill === 'og')
      .slice(0, 2)
    if (cast.length !== 2) throw new Error('need two OG personalities')
    const entrants = cast.map((personality) => ({ personality }))
    const ids = cast.map((person) => botPlayerId(person.id))
    for (let hand = firstHand; hand < firstHand + hands; hand += 1) {
      const { room } = openSessionHand(seed, 0, hand, 0, entrants, ids)
      const rng = mulberry32(seedFromString(`${seed}:${hand}:actions`))
      for (let step = 0; step < 300; step += 1) {
        if (performance.now() - started > 540_000)
          throw new Error('nine-minute harness limit reached')
        const publicView = room.viewFor('')
        if (publicView.phase !== 'hand') break
        const actor = publicView.currentActor?.playerId
        const index = ids.indexOf(actor ?? '')
        const personality = cast[index]
        if (actor === undefined || personality === undefined) throw new Error('missing actor')
        const view = room.viewFor(actor)
        const options = { roomId: room.id, publicActions: room.currentActions() }
        const action: TurnAction | null =
          index === 0
            ? await policy.think(
                { view, playerId: actor, personality, seed: Math.floor(rng() * 2 ** 32), options },
                budgetMs,
              )
            : actionFor(view, actor, personality, rng, { ...options, policy: pokerGuardPolicy })
        if (action === null || !room.submit({ kind: 'act', playerId: actor, action }).ok) {
          throw new Error('wrapper returned no legal action')
        }
      }
      if (room.viewFor('').phase === 'hand') throw new Error('hand exceeded action limit')
      policy.releaseHand(room.id, room.viewFor('').handNumber)
      completed += 1
      sample()
      if (completed % 10 === 0)
        process.stderr.write(
          `readiness ${completed}/${hands}, ${Math.round((performance.now() - started) / 1000)}s\n`,
        )
    }
    // Settlement is asynchronous across worker ports. Check the acknowledged state.
    for (let attempt = 0; attempt < 100 && policy.diagnostics().chains > 0; attempt += 1)
      await pause(10)
    const finalMemory = policy.diagnostics()
    if (finalMemory.activeHands !== 0 || finalMemory.chains !== 0 || finalMemory.entries !== 0) {
      throw new Error(`unreleased hand records: ${JSON.stringify(finalMemory)}`)
    }
    sample()
    report = {
      config,
      seed,
      firstHand,
      reference: 'pokerGuardPolicy (v8z before the river)',
      hands: completed,
      wallMs: performance.now() - started,
      coldStartWallMs,
      modelLoad: events,
      initialRss,
      loadedRss,
      peakRss: Math.max(loadedRss, process.memoryUsage().rss, ...rss.map((point) => point.bytes)),
      finalRss: process.memoryUsage().rss,
      latencyMs: Object.fromEntries(
        Object.entries(latencies).map(([street, values]) => [street, latencySummary(values)]),
      ),
      stats: policy.stats,
      peakCarryBytes,
      peakCarryEntries,
      finalMemory,
      rss,
      decisionSamplesMs: latencies,
    }
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ ...report, rss: `${rss.length} samples in ${output}` }, null, 2))
  } finally {
    clearInterval(sampling)
    clearTimeout(watchdog)
    await policy.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
