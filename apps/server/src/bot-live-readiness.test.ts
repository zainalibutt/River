import { expect, it } from 'vitest'
import {
  combineReadinessBatches,
  latencySummary,
  type ReadinessBatch,
} from './bot-live-readiness.js'
import { liveSafeConfig } from './bot-live-safe.js'

function batch(firstHand: number, values: number[]): ReadinessBatch {
  return {
    config: liveSafeConfig(),
    seed: 'same-deals',
    firstHand,
    hands: 1,
    wallMs: 10,
    coldStartWallMs: 1,
    modelLoad: [],
    initialRss: 10,
    loadedRss: 20,
    peakRss: 30,
    finalRss: 25,
    peakCarryBytes: 3,
    peakCarryEntries: 1,
    finalMemory: { activeHands: 0, chains: 0, entries: 0, bytes: 0 },
    stats: {
      decisions: values.length,
      safeDecisions: values.length,
      guardFallbacks: 0,
      workerStarts: 2,
      coldStartMs: 1,
      shortenedSolves: 0,
      fallbacks: {},
    },
    rss: [],
    decisionSamplesMs: { flop: values },
  }
}

it('combines raw decisions rather than averaging batch percentiles and rejects gaps/overlap/leaks', () => {
  const a = batch(0, [1, 2, 3])
  const b = batch(1, [100])
  const report = combineReadinessBatches([b, a])
  expect(report.hands).toBe(2)
  expect(report.latencyMs.flop).toEqual({ count: 4, p50: 2, p95: 100, p99: 100, max: 100 })
  expect(() => combineReadinessBatches([a, a])).toThrow('nonoverlapping')
  expect(() => combineReadinessBatches([a, batch(2, [])])).toThrow('consecutive')
  expect(() =>
    combineReadinessBatches([{ ...a, finalMemory: { ...a.finalMemory, entries: 1 } }]),
  ).toThrow('leaked')
  expect(latencySummary([])).toEqual({ count: 0, p50: null, p95: null, p99: null, max: null })
})
