import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const [outArg, teacherArg, packedArg] = process.argv.slice(2)
if (!outArg || !teacherArg || !packedArg)
  throw new Error('usage: <run-output> <teacher-stem> <packed-cache>')
const out = resolve(outArg)
const rel = relative(process.cwd(), out)
if (!rel || rel.startsWith('..') || isAbsolute(rel))
  throw new Error('output must be below worktree')
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const packed = read(join(packedArg, 'packed.json'))
assert.ok(packed.complete && packed.holdingOrder === 'stride37')
const selection = read(join(out, 'selection.json'))
const commands = read(join(out, 'commands.json')) as {
  name: string
  exitCode: number
  seconds: number
}[]
assert.ok(commands.length > 0 && commands.every((c) => c.exitCode === 0))
for (const name of ['python-tests', 'teacher-profile-ts', 'teacher-profile-wasm'])
  assert.ok(
    commands.some((c) => c.name === name),
    `missing stage ${name}`,
  )
const teacher = read(`${teacherArg}.result.json`)
assert.ok(teacher.complete && teacher.joint === false)
assert.equal(teacher.splitSHA256, packed.splitSHA256)
const profiles = (name: string) => ({
  ts: read(join(out, `${name}-ts.json`)),
  wasm: read(join(out, `${name}-wasm.json`)),
})
const teacherProfiles = profiles('teacher')
type Row = { config: string; seed: number; c1: number; c2: number; tsMs: number; wasmMs: number }
const rows: Row[] = []
for (const [config, field] of [
  ['teacher-full-reference', 'fullResidual'],
  ['teacher-optimised', 'residual'],
]) {
  rows.push({
    config: config as string,
    seed: 0,
    c1: teacher.tests.c1.metrics.all,
    c2: teacher.tests.c2.metrics.all,
    tsMs: teacherProfiles.ts[field as string].medianUs / 1000,
    wasmMs: teacherProfiles.wasm[field as string].medianUs / 1000,
  })
}
const results = []
for (const config of ['h16', 'h32', 'h32x2']) {
  for (const seed of config === selection.best ? [0, 1, 2] : [0]) {
    for (const suffix of [
      'fit',
      'export',
      'parity-ts',
      'parity-wasm',
      'profile-ts',
      'profile-wasm',
    ])
      assert.ok(
        commands.some((c) => c.name === `${config}-${seed}-${suffix}`),
        `missing ${config}-${seed}-${suffix}`,
      )
    const result = read(join(out, config, `residual-${seed}.result.json`))
    assert.ok(result.complete && result.device === 'cuda' && result.passes === 16)
    assert.equal(result.seed, seed)
    assert.equal(result.hidden, config === 'h16' ? 16 : 32)
    assert.equal(result.layers, config === 'h32x2' ? 2 : 1)
    for (const suffix of ['.json', '.bin']) {
      assert.ok(
        readFileSync(join(out, config, `residual-${seed}-bucket${suffix}`)).equals(
          readFileSync(`${teacherArg}-bucket${suffix}`),
        ),
        'student bucket must remain byte identical',
      )
    }
    assert.equal(result.coverageRows, result.expectedRows)
    const c2 = packed.spots - 53550
    assert.equal(
      result.expectedRows,
      (packed.spots - 5355 - 2677 - Math.floor(c2 / 10) - Math.floor(c2 / 20)) * 2 * 1128,
    )
    assert.equal(result.splitSHA256, packed.splitSHA256)
    assert.equal(result.snapshotSHA256, packed.snapshotSHA256)
    assert.equal(result.teacherSHA256, packed.teacherSHA256)
    assert.equal(result.tests.c1.spots, 5355)
    assert.equal(result.tests.c2.spots, Math.floor((packed.spots - 53550) / 10))
    for (const backend of ['ts', 'wasm']) {
      const parity = read(join(out, `${config}-${seed}-parity-${backend}.log`))
      assert.equal(parity.backend, backend)
      assert.ok(parity.cases >= 5 && parity.featureMax <= 1e-5 && parity.outputMax <= 1e-5)
      const speed = profiles(`${config}-${seed}`)[backend as 'ts' | 'wasm']
      assert.equal(speed.backend, backend)
      assert.ok(speed.trainedResidual && speed.threads <= 2)
    }
    const speed = profiles(`${config}-${seed}`)
    rows.push({
      config,
      seed,
      c1: result.tests.c1.metrics.all,
      c2: result.tests.c2.metrics.all,
      tsMs: speed.ts.residual.medianUs / 1000,
      wasmMs: speed.wasm.residual.medianUs / 1000,
    })
    results.push(result)
  }
}
const best = rows.filter((r) => r.config === selection.best)
const stats = (values: number[]) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return {
    mean,
    sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)),
    min: Math.min(...values),
    max: Math.max(...values),
  }
}
const accuracyGate = best.length === 3 && best.every((r) => r.c1 <= 4.9 && r.c2 <= 4.9)
const speedGate = best.length === 3 && best.every((r) => r.wasmMs <= 2)
const summary = {
  selection,
  accuracyGate,
  speedGate,
  completionRequires: 'complete.json written by runner within 75 minutes',
  bestC1: stats(best.map((r) => r.c1)),
  bestC2: stats(best.map((r) => r.c2)),
  rows,
  results,
  commands,
}
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
writeFileSync(
  join(out, 'summary.csv'),
  `config,seed,c1MAE,c2MAE,tsMedianMs,wasmMedianMs\n${rows.map((r) => [r.config, r.seed, r.c1, r.c2, r.tsMs, r.wasmMs].join(',')).join('\n')}\n`,
)
const lines = [
  '# D8 distillation results',
  '',
  'Speed is median milliseconds per real spot, both players and all legal holdings, with board features cached. The full teacher reference uses the current copy kernel and uncompressed 2652-row batch. Card preparation is reported separately in profile JSON. No production policy changes.',
  '',
  '| Model | Seed | c1 MAE | c2 MAE | TS ms | WASM ms |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (r) =>
      `| ${r.config} | ${r.seed} | ${r.c1.toFixed(4)} | ${r.c2.toFixed(4)} | ${r.tsMs.toFixed(3)} | ${r.wasmMs.toFixed(3)} |`,
  ),
  '',
  `Best architecture: ${selection.best}, selected using calibration and speed only.`,
  `Three-seed c1: ${summary.bestC1.mean.toFixed(4)} +/- ${summary.bestC1.sd.toFixed(4)}; c2: ${summary.bestC2.mean.toFixed(4)} +/- ${summary.bestC2.sd.toFixed(4)} (sample SD).`,
  `Every-seed MAE <=4.9 on both cohorts: ${accuracyGate}. Every-seed WASM median <=2ms: ${speedGate}.`,
  'All trained exports passed actual PyTorch/TS/WASM parity <=1e-5. Completion also requires the runner complete.json marker and total elapsed <75 minutes.',
  '',
]
writeFileSync(join(out, 'summary.md'), `${lines.join('\n')}\n`)
process.stdout.write(`${lines.join('\n')}\n`)
if (!accuracyGate || !speedGate) process.exitCode = 2
