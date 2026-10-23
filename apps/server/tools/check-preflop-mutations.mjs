import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Run serially from the worktree root. Only these new offline-solver source files are edited.
// Original bytes are restored in finally, including when a mutation survives or Vitest fails.
const started = performance.now()
const output = resolve('out/preflop-solve/mutations')
mkdirSync(output, { recursive: true })
const env = {
  ...process.env,
  UV_THREADPOOL_SIZE: '1',
  GOMAXPROCS: '1',
  OMP_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
  NODE_OPTIONS: '--v8-pool-size=1',
}
const mutations = [
  {
    id: 'reverse-regret-update',
    file: 'cfr',
    from: 'discounted +',
    to: 'discounted -',
    test: 'solves the toy',
  },
  {
    id: 'reverse-equity-winner',
    file: 'equity',
    from: 'const won = one > two ? 1 : one === two ? 0.5 : 0',
    to: 'const won = one < two ? 1 : one === two ? 0.5 : 0',
    test: 'spot-checks AA/KK',
  },
  {
    id: 'ignore-card-removal',
    file: 'equity',
    from: 'return a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]',
    to: 'return true',
    test: 'partitions all 1326 combos',
  },
  {
    id: 'remove-stack-cap',
    file: 'tree',
    from: 'targets.add(Math.min(depth, Math.max(sized, paid[other] + lastRaise)))',
    to: 'targets.add(Math.max(sized, paid[other] + lastRaise))',
    test: 'enforces minimum raises, caps',
  },
  {
    id: 'corrupt-best-response',
    file: 'br',
    from: 'Math.max(best, value[h] as number)',
    to: 'Math.max(best, -value[h])',
    test: 'matches every BR',
  },
  {
    id: 'halve-reported-exploitability',
    file: 'br',
    from: 'exploitabilityBb: nashConvBb / 2,',
    to: 'exploitabilityBb: nashConvBb / 4,',
    test: 'matches every BR',
  },
  {
    id: 'use-zero-sum-certificate',
    file: 'br',
    from: 'exploitabilityBb: nashConvBb / 2,',
    to: 'exploitabilityBb: (bestResponseValueBb[0] + bestResponseValueBb[1]) / 2,',
    test: 'uses actual blocked node ranges',
  },
  {
    id: 'apply-realisation-to-all-in',
    file: 'tree',
    from: "node.kind === 'all-in' ? 1 : player === 0 ? factors.ip : factors.oop",
    to: 'player === 0 ? factors.ip : factors.oop',
    test: 'bypasses realisation for all-ins',
  },
]

function suite(id) {
  const report = resolve(output, `${id}.json`)
  const result = spawnSync(
    process.execPath,
    [
      '--v8-pool-size=1',
      'node_modules/vitest/vitest.mjs',
      'run',
      'apps/server/src/bot-preflop-solve',
      '--maxWorkers=1',
      '--no-file-parallelism',
      '--reporter=json',
      `--outputFile=${report}`,
    ],
    { env, encoding: 'utf8', timeout: 45000, windowsHide: true },
  )
  writeFileSync(resolve(output, `${id}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (result.error) throw result.error
  const parsed = JSON.parse(readFileSync(report, 'utf8'))
  const failed = parsed.testResults.flatMap((test) =>
    test.assertionResults.filter((a) => a.status === 'failed').map((a) => a.fullName),
  )
  return { exitCode: result.status, failedTests: parsed.numFailedTests, failed }
}

const baseline = suite('baseline')
if (baseline.exitCode !== 0 || baseline.failedTests !== 0) throw new Error('baseline tests failed')
const results = []
for (const mutation of mutations) {
  if ((performance.now() - started) / 1000 > 420)
    throw new Error('mutation-run time budget reached')
  const path = resolve(`apps/server/src/bot-preflop-solve-${mutation.file}.ts`)
  const original = readFileSync(path)
  try {
    const source = original.toString('utf8').replaceAll('\r\n', '\n')
    if (source.split(mutation.from).length !== 2)
      throw new Error(`mutation anchor not unique: ${mutation.id}`)
    writeFileSync(path, source.replace(mutation.from, mutation.to))
    const result = suite(mutation.id)
    const killed =
      result.exitCode === 1 &&
      result.failedTests > 0 &&
      result.failed.some((name) => name.includes(mutation.test))
    results.push({ id: mutation.id, killed, ...result })
    process.stdout.write(
      `${JSON.stringify({ id: mutation.id, killed, exitCode: result.exitCode, failedTests: result.failedTests })}\n`,
    )
    if (!killed) throw new Error(`mutation survived or failed for the wrong reason: ${mutation.id}`)
  } finally {
    writeFileSync(path, original)
  }
}
writeFileSync(
  resolve(output, 'summary.json'),
  `${JSON.stringify({ baseline, results, seconds: (performance.now() - started) / 1000 }, null, 2)}\n`,
)
