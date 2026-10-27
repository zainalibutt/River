import { expect, it } from 'vitest'
import { quantiles, totalVariation } from './bot-flop-leaf-benchmark.js'

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
