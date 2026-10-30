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
  })
  expect(record.models.RIVER_TURN_RESIDUAL).toBeNull()
  expect(record.environment).toMatchObject({ RIVER_OPPONENT_PREFLOP_PRIOR: null })
  expect(record.models.RIVER_OPPONENT_PREFLOP_PRIOR).toBeNull()
})

it.each(['lbr', 'slumbot'])(
  'records both env values and all residual file hashes for %s',
  (runner) => {
    directory = mkdtempSync(join(process.cwd(), 'art/out/residual-provenance-test-'))
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
  directory = mkdtempSync(join(process.cwd(), 'art/out/opponent-provenance-test-'))
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
