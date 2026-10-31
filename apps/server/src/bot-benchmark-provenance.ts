import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIVAT_HEURISTIC, AIVAT_V2_HEURISTIC } from './bot-aivat.js'
import { flopDiagnosticsFromEnvironment } from './bot-flop-diagnostics.js'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const specification = fileURLToPath(new URL('../benchmark/frozen-v2.json', import.meta.url))
const digest = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Read refs without invoking git or changing its index, locks, refs or config. */
function commitId(): string | null {
  if (/^[a-f0-9]{40}$/i.test(process.env.RIVER_BENCH_COMMIT ?? ''))
    return process.env.RIVER_BENCH_COMMIT as string
  try {
    const dot = join(root, '.git')
    const directory = statSync(dot).isDirectory()
      ? dot
      : resolve(
          root,
          readFileSync(dot, 'utf8')
            .trim()
            .replace(/^gitdir:\s*/, ''),
        )
    const head = readFileSync(join(directory, 'HEAD'), 'utf8').trim()
    if (!head.startsWith('ref: ')) return head
    const ref = head.slice(5)
    const commonFile = join(directory, 'commondir')
    const common = existsSync(commonFile)
      ? resolve(directory, readFileSync(commonFile, 'utf8').trim())
      : directory
    const loose = join(common, ref)
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    return (
      readFileSync(join(common, 'packed-refs'), 'utf8')
        .split('\n')
        .find((line) => line.endsWith(` ${ref}`))
        ?.split(' ')[0] ?? null
    )
  } catch {
    return null
  }
}

export function sourceDigest(paths = ['apps/server/src', 'packages/engine/src']): string {
  const hash = createHash('sha256')
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name)
      const label = `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, label)
      else if (/\.(ts|js|json)$/.test(entry.name)) {
        hash.update(label).update('\0').update(readFileSync(path)).update('\0')
      }
    }
  }
  for (const path of paths) walk(join(root, path), path)
  return hash.digest('hex')
}

export interface BenchmarkWorkload {
  readonly policies: readonly string[]
  readonly seeds: readonly string[]
  readonly plannedHands: number
  readonly settings?: Readonly<Record<string, unknown>>
}

export function benchmarkProvenance(runner: string, workload: BenchmarkWorkload) {
  flopDiagnosticsFromEnvironment()
  const models: Record<string, Record<string, string> | null> = {}
  for (const name of [
    'RIVER_FLOP_NETWORK',
    'RIVER_TURN_NETWORK',
    'RIVER_TURN_START_NETWORK',
    'RIVER_RIVER_NETWORK',
  ]) {
    const stem = process.env[name]
    models[name] = stem
      ? Object.fromEntries(
          [stem, `${stem}.json`, `${stem}.bin`]
            .filter(existsSync)
            .map((path) => [basename(path), digest(readFileSync(path))]),
        )
      : null
  }
  const residual = process.env.RIVER_TURN_RESIDUAL
  models.RIVER_TURN_RESIDUAL = residual
    ? Object.fromEntries(
        [
          `${residual}.json`,
          `${residual}-bucket.json`,
          `${residual}-bucket.bin`,
          `${residual}-head.json`,
          `${residual}-head.bin`,
        ]
          .filter(existsSync)
          .map((path) => [basename(path), digest(readFileSync(path))]),
      )
    : null
  const pack = process.env.RIVER_PREFLOP_PACK ?? 'v3'
  const opponentPrior = process.env.RIVER_OPPONENT_PREFLOP_PRIOR
  models.RIVER_OPPONENT_PREFLOP_PRIOR =
    opponentPrior === undefined
      ? null
      : {
          [basename(opponentPrior)]: digest(readFileSync(opponentPrior)),
        }
  const preflop = [100, 200].map((depth) => {
    const path = join(dirname(specification), '..', 'preflop', pack, `${depth}bb.json`)
    return { depth, sha256: existsSync(path) ? digest(readFileSync(path)) : null }
  })
  const env = Object.fromEntries(
    [
      'RIVER_VALUE_BACKEND',
      'RIVER_VALUE_THREADS',
      'RIVER_COMPARE_HANDS',
      'RIVER_PREFLOP_PACK',
      'RIVER_OPPONENT_PREFLOP_PRIOR',
      'RIVER_TURN_RESIDUAL',
      'RIVER_TURN_RESIDUAL_REFRESH',
      'RIVER_TURN_EXPLICIT_LEAF',
      'RIVER_FLOP_BET_SIZES',
      'RIVER_DIAG_GADGET',
      'RIVER_DIAG_IP_JAM_OVER_RAISE',
      'RIVER_DIAG_ALLIN_RUNOUTS',
      'RIVER_DIAG_FLOP_RAISES',
      'RIVER_DIAG_ITERATIONS_MULTIPLIER',
      'RIVER_DIAG_WARM_START',
      'OMP_NUM_THREADS',
      'OPENBLAS_NUM_THREADS',
      'UV_THREADPOOL_SIZE',
    ].map((name) => [name, process.env[name] ?? null]),
  )
  return {
    schema: 'river-benchmark-provenance-v1',
    benchmark: 'd8-frozen-v2',
    specificationSha256: digest(readFileSync(specification)),
    runner,
    startedAt: new Date().toISOString(),
    commit: commitId(),
    sourceSha256: sourceDigest(),
    engineRuntimeSha256: existsSync(join(root, 'packages/engine/dist'))
      ? sourceDigest(['packages/engine/dist'])
      : null,
    lockfileSha256: digest(readFileSync(join(root, 'package-lock.json'))),
    models,
    preflop: { version: pack, files: preflop },
    environment: { node: process.version, platform: process.platform, arch: process.arch, ...env },
    heuristic: process.env.RIVER_AIVAT_HEURISTIC === 'v2' ? AIVAT_V2_HEURISTIC : AIVAT_HEURISTIC,
    ...workload,
  }
}

/** Sidecar exists before play. Crashes retain an incomplete record; failures
 * are counts/codes, never private paths, credentials or exception strings. */
export function beginBenchmark(out: string, runner: string, workload: BenchmarkWorkload) {
  const provenance = benchmarkProvenance(runner, workload)
  const file = `${out}.provenance.json`
  let finished = false
  let completedHands = 0
  let observedFailures = 0
  const write = (status: string, hands: number, failures: number) => {
    writeFileSync(file, `${JSON.stringify({ ...provenance, status, hands, failures }, null, 2)}\n`)
  }
  write('running', 0, 0)
  const onExit = () => {
    if (!finished) write('incomplete', completedHands, observedFailures + 1)
  }
  process.once('exit', onExit)
  return {
    provenance,
    progress(hands: number, failures = 0) {
      completedHands = hands
      observedFailures = failures
      write('running', hands, failures)
    },
    finish(hands: number, failures = 0) {
      write(
        failures === 0 && hands === workload.plannedHands ? 'complete' : 'incomplete',
        hands,
        failures,
      )
      finished = true
      process.removeListener('exit', onExit)
    },
  }
}
