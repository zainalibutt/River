import { personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { trainContextualActionModel } from './bot-learning-model.js'
import { authoredShiftSeats, runLearningShiftV2 } from './bot-learning-shift-v2.js'

describe('authored opponent-action distribution shift', () => {
  it('collects legal, reproducible decisions from four non-training styles', () => {
    const seats = authoredShiftSeats([2, 7, 9, 11])
    const options = { seed: 'authored-shift-test', hands: 8, seats }
    const rows = collectLearningExamplesV2(options)
    expect(collectLearningExamplesV2(options)).toEqual(rows)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map((row) => row.actorId)).size).toBe(4)
    expect(rows.every((row) => row.legalLabels.includes(row.label))).toBe(true)
    expect(new Set(rows.map((row) => row.label)).size).toBeGreaterThan(2)
  })

  it('evaluates a frozen model without fitting on shift decisions', () => {
    const seats = personalityPool()
      .slice(0, 4)
      .map((personality) => ({ personality }))
    const training = collectLearningExamplesV2({ seed: 'shift-train-test', hands: 12, seats })
    const model = trainContextualActionModel(training, {
      epochs: 12,
      learningRate: 0.35,
      l2: 0.002,
    })
    const options = { seed: 'shift-confirm-test', hands: 6, castIndices: [4, 7, 9, 11] }
    const first = runLearningShiftV2(model, training, options)
    expect(runLearningShiftV2(model, training, options)).toEqual(first)
    expect(first.count).toBeGreaterThan(0)
    expect(first.evaluation.heldOutHands).toBe(6)
    expect(first.byStyle.map((row) => row.style)).toEqual([
      'nit',
      'calling-station',
      'pressure',
      'mixed',
    ])
    expect(first.byStyle.reduce((sum, row) => sum + row.count, 0)).toBe(first.count)
    expect(first.evaluation.learned.logLoss).toBeGreaterThanOrEqual(0)
    expect(first.evaluation.statistical.logLoss).toBeGreaterThanOrEqual(0)
    expect(() =>
      runLearningShiftV2(model, training, { ...options, seed: 'shift-train-test' }),
    ).toThrow('overlap')
  })

  it('rejects missing or repeated authored cast identities', () => {
    expect(() => authoredShiftSeats([0, 1, 2])).toThrow('four distinct')
    expect(() => authoredShiftSeats([0, 1, 1, 2])).toThrow('four distinct')
    expect(() => authoredShiftSeats([0, 1, 2, 99])).toThrow('cast missing')
  })
})
