import { personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { BOT_LEARNING_CAMPAIGN_V3, runLearningCampaignV3 } from './bot-learning-campaign-v3.js'
import { collectLearningExamplesV2 } from './bot-learning-data-v2.js'
import { trainContextualActionModel } from './bot-learning-model.js'
import { authoredNovelSeats } from './bot-learning-novel-v3.js'

const cast = personalityPool()
const frozenTraining = collectLearningExamplesV2({
  seed: 'v3-fixture-frozen',
  hands: 12,
  seats: cast.slice(0, 4).map((personality) => ({ personality })),
})
const frozen = trainContextualActionModel(frozenTraining, {
  epochs: 12,
  learningRate: 0.35,
  l2: 0.002,
})
const small = {
  ...BOT_LEARNING_CAMPAIGN_V3,
  baseTrainingHands: 12,
  styleTrainingHands: 12,
  baseValidationHands: 5,
  styleValidationHands: 5,
  baseTestHands: 5,
  knownStyleTestHands: 5,
  novelStyleTestHands: 8,
  eightSeatTestHands: 5,
  nineSeatTestHands: 5,
  trainingEpochs: 12,
}

describe('version-three opponent-action experiment', () => {
  it('keeps a novel legal and reproducible test corpus outside training', () => {
    const seats = authoredNovelSeats([2, 7, 9, 11])
    const options = { seed: 'v3-novel-fixture', hands: 8, seats }
    const rows = collectLearningExamplesV2(options)
    expect(collectLearningExamplesV2(options)).toEqual(rows)
    expect(new Set(rows.map((row) => row.actorId)).size).toBe(4)
    expect(rows.every((row) => row.legalLabels.includes(row.label))).toBe(true)
    expect(new Set(rows.map((row) => row.label)).size).toBeGreaterThan(2)
  })

  it('compares a candidate to a frozen model without writing live state', () => {
    const result = runLearningCampaignV3(frozen, small)
    expect(result.counts.training).toBeGreaterThan(0)
    expect(result.baseTests).toHaveLength(2)
    expect(result.novelByStyle).toHaveLength(4)
    expect(result.eightSeatTest.candidate.learned.count).toBeGreaterThan(0)
    expect(result.nineSeatTest.candidate.learned.count).toBeGreaterThan(0)
    expect(result.novelByStyle.reduce((sum, row) => sum + row.count, 0)).toBe(result.counts.novel)
    expect(result.liveInferenceEnabled).toBe(false)
    expect(runLearningCampaignV3(frozen, small)).toEqual(result)
  })

  it('rejects reused seeds and overlapping novel identities before collection', () => {
    expect(() =>
      runLearningCampaignV3(frozen, {
        ...small,
        novelStyleTestSeed: small.styleTrainingSeed,
      }),
    ).toThrow('seed reuse')
    expect(() =>
      runLearningCampaignV3(frozen, {
        ...small,
        novelCastIndices: [0, 7, 9, 11],
      }),
    ).toThrow('novel cast overlaps')
    expect(() => authoredNovelSeats([2, 7, 7, 11])).toThrow('four distinct')
    expect(() => runLearningCampaignV3(frozen, { ...small, nineSeatCastIndex: 0 })).toThrow(
      'duplicates another identity',
    )
  })
})
