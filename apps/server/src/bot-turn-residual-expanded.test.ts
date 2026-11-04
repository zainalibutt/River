import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import {
  checkHistoricalSplit,
  claimSpot,
  expandedSplit,
  expandedTeacherHash,
} from './bot-turn-residual-expanded.js'
import { historicalOrder } from './bot-turn-residual-split.js'

describe('D8 expanded data isolation', () => {
  it('hashes a remapped teacher and rejects a different checkpoint name or parent', () => {
    const root = mkdtempSync(join(process.cwd(), '.expanded-teacher-test-'))
    try {
      const directory = join(root, 'night1-buckets')
      mkdirSync(directory)
      const stem = join(directory, 'river-buckets-128')
      const metadata = '{"fixture":true}'
      const weights = Buffer.from([1, 2, 3])
      writeFileSync(`${stem}.json`, metadata)
      writeFileSync(`${stem}.bin`, weights)
      const expected = createHash('sha256').update(metadata).update(weights).digest('hex')
      for (const separator of ['/', '\\']) {
        const remote = ['generator', 'night1-buckets', 'river-buckets-128'].join(separator)
        expect(expandedTeacherHash(remote, stem)).toBe(expected)
        expect(() => expandedTeacherHash(`${remote}-other`, stem)).toThrow(
          'last two path components',
        )
        expect(() => expandedTeacherHash(remote.replace('night1', 'night2'), stem)).toThrow(
          'last two path components',
        )
      }
      expect(expandedTeacherHash(stem)).toBe(expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps historical c1 membership and independently holds out c2', () => {
    const split = expandedSplit(173025)
    const c1 = historicalOrder()
    expect(split.historicalSplitSHA256).toBe(c1.sha256)
    expect(split.testSets.c1).toEqual(c1.order.slice(0, 5355))
    expect(split.calibrationSets.c1).toEqual(c1.order.slice(5355, 8032))
    expect(split.testSets.c2).toHaveLength(17302)
    expect(split.calibrationSets.c2).toHaveLength(8651)
    const all = [...split.training, ...split.calibration, ...split.test]
    expect(all).toHaveLength(226575)
    expect(new Set(all).size).toBe(all.length)
    expect(Math.min(...split.testSets.c2)).toBeGreaterThanOrEqual(53550)
    expect(expandedSplit(173025).splitSHA256).toBe(split.splitSHA256)
    expect(split.splitSHA256).toBe(
      '7bec7f1fb1378fcc75fd691f4eca67646542067eb3f504bc8cbec633010025dd',
    )
    expect(expandedSplit(173050).splitSHA256).not.toBe(split.splitSHA256)
  })

  it('rejects reordered historical rows even if its declared hash is unchanged', () => {
    const { order, sha256 } = historicalOrder()
    const old = {
      test: order.slice(0, 5355),
      calibration: order.slice(5355, 8032),
      training: order.slice(8032),
      splitSHA256: sha256,
    }
    checkHistoricalSplit(old)
    old.test.reverse()
    expect(() => checkHistoricalSplit(old)).toThrow('c1 test changed')
  })

  it('allows worker/spot reuse across seeds, rejects duplicate identities and copied records', () => {
    const seen = new Set<string>(),
      contents = new Set<string>()
    const first = Buffer.alloc(RIVER_RECORD_BYTES)
    claimSpot(seen, contents, 'c1', first)
    const different = Buffer.from(first)
    different.writeFloatLE(42, 8)
    claimSpot(seen, contents, 'c2', different)
    expect(() => claimSpot(seen, contents, 'c2', first)).toThrow('duplicate')
    expect(() => claimSpot(seen, contents, 'c3', first)).toThrow('duplicate')
    different.writeFloatLE(43, 8)
    expect(() => claimSpot(seen, contents, 'c1', different)).toThrow('duplicate')
  })
})
