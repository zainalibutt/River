import { expect, it } from 'vitest'
import {
  benchmarkThreads,
  benchmarkVariants,
  quantiles,
  residualVariant,
  totalVariation,
} from './bot-flop-leaf-benchmark.js'

it('uses nearest-rank latency quantiles and action probability total variation', () => {
  expect(quantiles(Array.from({ length: 30 }, (_, i) => i + 1))).toEqual({
    p50: 15,
    p95: 29,
    max: 30,
    mean: 15.5,
  })
  expect(totalVariation([0.2, 0.8], [0.7, 0.3])).toBeCloseTo(0.5)
  expect(totalVariation([0.2, 0.8], [0.2, 0.8])).toBe(0)
  expect(() => totalVariation([1], [0, 1])).toThrow('actions changed')
})

it('enumerates all batched and correction schedules without silently accepting variants', () => {
  expect(benchmarkVariants).toHaveLength(13)
  expect(residualVariant('h32-once')).toEqual({ name: 'h32', refreshIterations: 'never' })
  expect(residualVariant('h32x2-r10')).toEqual({ name: 'h32x2', refreshIterations: 10 })
  expect(residualVariant('teacher-r20')).toEqual({ name: 'teacher', refreshIterations: 20 })
  expect(residualVariant('teacher')).toEqual({ name: 'teacher', refreshIterations: undefined })
  expect(() => residualVariant('teacher-r0')).toThrow('unknown leaf variant')
})

it('assigns at most one worker to the dominant network for every benchmark schedule', () => {
  expect(benchmarkThreads('plain')).toEqual({ bucket: 2, head: null })
  expect(benchmarkThreads('h32')).toEqual({ bucket: 1, head: 2 })
  expect(benchmarkThreads('h32-once')).toEqual({ bucket: 2, head: 1 })
  expect(benchmarkThreads('h32x2-r10')).toEqual({ bucket: 2, head: 1 })
  for (const variant of ['teacher', 'teacher-once', 'teacher-r10', 'teacher-r20'])
    expect(benchmarkThreads(variant)).toEqual({ bucket: 1, head: 2 })
  for (const variant of benchmarkVariants) {
    const threads = benchmarkThreads(variant)
    expect(threads.bucket + (threads.head ?? 1) - 1).toBeLessThanOrEqual(2)
  }
})
