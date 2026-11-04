import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { beginBenchmark, benchmarkProvenance } from './bot-benchmark-provenance.js'

let directory: string | undefined

beforeEach(() => {
  vi.stubEnv('RIVER_DIAG_GADGET', undefined)
  vi.stubEnv('RIVER_DIAG_IP_JAM_OVER_RAISE', undefined)
  vi.stubEnv('RIVER_DIAG_ALLIN_RUNOUTS', undefined)
  vi.stubEnv('RIVER_DIAG_WARM_START', undefined)
  vi.stubEnv('RIVER_FLOP_BET_SIZES', undefined)
  vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', undefined)
  vi.stubEnv('RIVER_TURN_RESIDUAL', undefined)
  vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', undefined)
  vi.stubEnv('RIVER_OPPONENT_PREFLOP_PRIOR', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (directory !== undefined) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file))
    rmdirSync(directory)
    directory = undefined
  }
})

it('records unset residual environment values without model hashes', () => {
  const record = benchmarkProvenance('lbr', {
    policies: ['v9go'],
    seeds: ['smoke'],
    plannedHands: 2,
  })
  expect(record.environment).toMatchObject({
    RIVER_TURN_RESIDUAL: null,
    RIVER_TURN_RESIDUAL_REFRESH: null,
    RIVER_TURN_EXPLICIT_LEAF: null,
    RIVER_FLOP_BET_SIZES: null,
    RIVER_DIAG_GADGET: null,
    RIVER_DIAG_IP_JAM_OVER_RAISE: null,
    RIVER_DIAG_ALLIN_RUNOUTS: null,
    RIVER_DIAG_WARM_START: null,
  })
  expect(record.models.RIVER_TURN_RESIDUAL).toBeNull()
  expect(record.environment).toMatchObject({ RIVER_OPPONENT_PREFLOP_PRIOR: null })
  expect(record.models.RIVER_OPPONENT_PREFLOP_PRIOR).toBeNull()
})

it('records the explicit flop tree environment', () => {
  vi.stubEnv('RIVER_FLOP_BET_SIZES', '0.33,0.5,0.66,1')
  expect(
    benchmarkProvenance('flop-replay', { policies: ['v9gp'], seeds: ['s'], plannedHands: 3 })
      .environment,
  ).toMatchObject({ RIVER_FLOP_BET_SIZES: '0.33,0.5,0.66,1' })
})

it.each([
  ['RIVER_DIAG_GADGET', 'off'],
  ['RIVER_DIAG_IP_JAM_OVER_RAISE', '1'],
  ['RIVER_DIAG_ALLIN_RUNOUTS', '1176'],
  ['RIVER_DIAG_WARM_START', '1'],
])('records the explicit flop diagnostic %s', (name, value) => {
  vi.stubEnv(name, value)
  expect(
    benchmarkProvenance('flop-replay', { policies: ['v9gp'], seeds: ['s'], plannedHands: 1 })
      .environment,
  ).toMatchObject({ [name]: value })
})

it.each([
  'RIVER_DIAG_GADGET',
  'RIVER_DIAG_IP_JAM_OVER_RAISE',
  'RIVER_DIAG_ALLIN_RUNOUTS',
  'RIVER_DIAG_WARM_START',
])('rejects invalid diagnostic %s before recording provenance', (name) => {
  vi.stubEnv(name, 'bad')
  expect(() =>
    benchmarkProvenance('flop-replay', { policies: [], seeds: [], plannedHands: 0 }),
  ).toThrow(name)
})

it.each(['never', '20'])('records explicit turn leaf refresh %s in provenance', (refresh) => {
  vi.stubEnv('RIVER_TURN_EXPLICIT_LEAF', refresh)
  const record = benchmarkProvenance('flop-replay', {
    policies: ['v9gp'],
    seeds: ['smoke'],
    plannedHands: 2,
  })
  expect(record.environment).toMatchObject({ RIVER_TURN_EXPLICIT_LEAF: refresh })
  expect(record.models.RIVER_TURN_RESIDUAL).toBeNull()
})

it.each(['lbr', 'slumbot'])(
  'records both env values and all residual file hashes for %s',
  (runner) => {
    directory = mkdtempSync(join(process.cwd(), 'apps/server/.residual-provenance-test-'))
    const stem = join(directory, 'residual-0')
    const expected: Record<string, string> = {}
    for (const suffix of ['.json', '-bucket.json', '-bucket.bin', '-head.json', '-head.bin']) {
      const path = `${stem}${suffix}`
      const content = `fixture${suffix}`
      writeFileSync(path, content)
      expected[basename(path)] = createHash('sha256').update(content).digest('hex')
    }
    vi.stubEnv('RIVER_TURN_RESIDUAL', stem)
    vi.stubEnv('RIVER_TURN_RESIDUAL_REFRESH', 'never')
    const out = join(directory, 'smoke.json')
    const record = beginBenchmark(out, runner, {
      policies: ['v9go'],
      seeds: ['smoke'],
      plannedHands: 2,
    })
    record.finish(2)
    const saved = JSON.parse(readFileSync(`${out}.provenance.json`, 'utf8'))
    expect(saved.status).toBe('complete')
    expect(saved.runner).toBe(runner)
    expect(saved.environment).toMatchObject({
      RIVER_TURN_RESIDUAL: stem,
      RIVER_TURN_RESIDUAL_REFRESH: 'never',
    })
    expect(saved.models.RIVER_TURN_RESIDUAL).toEqual(expected)
  },
)

it('records the opponent prior env value and exact file hash', () => {
  directory = mkdtempSync(join(process.cwd(), 'apps/server/.opponent-provenance-test-'))
  const file = join(directory, 'prior.json')
  const content = '{"diagnostic":true}\n'
  writeFileSync(file, content)
  vi.stubEnv('RIVER_OPPONENT_PREFLOP_PRIOR', file)
  const record = benchmarkProvenance('slumbot', {
    policies: ['v9gp'],
    seeds: ['prior'],
    plannedHands: 1,
  })
  expect(record.environment).toMatchObject({ RIVER_OPPONENT_PREFLOP_PRIOR: file })
  expect(record.models.RIVER_OPPONENT_PREFLOP_PRIOR).toEqual({
    'prior.json': createHash('sha256').update(content).digest('hex'),
  })
})

it.each([undefined, '1'])('records each named policy warm option with env=%s', (env) => {
  vi.stubEnv('RIVER_DIAG_WARM_START', env)
  const record = benchmarkProvenance('duplicate', {
    policies: ['v9gpw', 'v9gp', 'v9gpw2'],
    seeds: ['smoke'],
    plannedHands: 4,
  })
  expect(record.policyOptions).toEqual({
    v9gp: { offTree: 'resolve', preflopTables: true, warmStart: env === '1' },
    v9gpw: { offTree: 'resolve', preflopTables: true, warmStart: true },
    v9gpw2: {
      offTree: 'resolve',
      preflopTables: true,
      warmStart: true,
      resolveIterationMultiplier: 2,
    },
  })
})
