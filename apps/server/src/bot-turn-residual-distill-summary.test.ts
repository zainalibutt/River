import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('requires every stage and full holding coverage, and fails if either test cohort misses the accuracy gate', () => {
  const out = mkdtempSync(join(process.cwd(), '.d8-summary-test-'))
  const teacher = join(out, 'teacher')
  const json = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value))
  const commands: { name: string; exitCode: number; seconds: number }[] = []
  const stage = (name: string) => commands.push({ name, exitCode: 0, seconds: 1 })
  const run = () =>
    spawnSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'apps/server/src/bot-turn-residual-distill-summary.ts',
        out,
        teacher,
        out,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
  try {
    for (const suffix of ['.json', '.bin'])
      writeFileSync(`${teacher}-bucket${suffix}`, 'immutable fixture')
    json(`${teacher}.result.json`, {
      complete: true,
      joint: false,
      splitSHA256: 'split',
      tests: { c1: { metrics: { all: 4.6 } }, c2: { metrics: { all: 4.6 } } },
    })
    json(join(out, 'packed.json'), {
      complete: true,
      holdingOrder: 'stride37',
      spots: 53570,
      splitSHA256: 'split',
      snapshotSHA256: 'snapshot',
      teacherSHA256: 'teacher',
    })
    json(join(out, 'selection.json'), { best: 'h16' })
    stage('python-tests')
    for (const backend of ['ts', 'wasm']) {
      stage(`teacher-profile-${backend}`)
      json(join(out, `teacher-${backend}.json`), {
        residual: { medianUs: 9000 },
        fullResidual: { medianUs: 13000 },
      })
    }
    for (const config of ['h16', 'h32', 'h32x2']) {
      mkdirSync(join(out, config))
      for (const seed of config === 'h16' ? [0, 1, 2] : [0]) {
        const result = {
          complete: true,
          device: 'cuda',
          passes: 16,
          seed,
          hidden: config === 'h16' ? 16 : 32,
          layers: config === 'h32x2' ? 2 : 1,
          coverageRows: 45535 * 2256,
          expectedRows: 45535 * 2256,
          splitSHA256: 'split',
          snapshotSHA256: 'snapshot',
          teacherSHA256: 'teacher',
          tests: {
            c1: { spots: 5355, metrics: { all: 4.8 } },
            c2: { spots: 2, metrics: { all: 4.8 } },
          },
        }
        json(join(out, config, `residual-${seed}.result.json`), result)
        for (const suffix of ['.json', '.bin'])
          writeFileSync(join(out, config, `residual-${seed}-bucket${suffix}`), 'immutable fixture')
        for (const suffix of [
          'fit',
          'export',
          'parity-ts',
          'parity-wasm',
          'profile-ts',
          'profile-wasm',
        ])
          stage(`${config}-${seed}-${suffix}`)
        for (const backend of ['ts', 'wasm']) {
          json(join(out, `${config}-${seed}-parity-${backend}.log`), {
            backend,
            cases: 5,
            featureMax: 1e-7,
            outputMax: 1e-7,
          })
          json(join(out, `${config}-${seed}-${backend}.json`), {
            backend,
            trainedResidual: true,
            threads: 1,
            residual: { medianUs: 1500 },
          })
        }
      }
    }
    json(join(out, 'commands.json'), commands)
    const accepted = run()
    expect(accepted.stderr).toBe('')
    expect(accepted.status).toBe(0)
    const file = join(out, 'h16/residual-1.result.json')
    const result = JSON.parse(readFileSync(file, 'utf8'))
    result.tests.c2.metrics.all = 5.0
    json(file, result)
    expect(run().status).toBe(2)
    expect(JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).accuracyGate).toBe(false)
    result.expectedRows = result.coverageRows = 0
    json(file, result)
    expect(run().status).toBe(1)
  } finally {
    rmSync(out, { recursive: true })
  }
}, 15000)
