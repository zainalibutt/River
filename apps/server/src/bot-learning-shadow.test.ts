import { describe, expect, it } from 'vitest'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'
import { ACTION_LABELS, type ActionModelV1 } from './bot-learning-model.js'
import {
  ACTION_SHADOW_LIMITS,
  OnlineActionShadow,
  type PreparedActionShadow,
} from './bot-learning-shadow.js'

const weights = ACTION_LABELS.map(() => Array(LEARNING_FEATURES_V2.length + 1).fill(0) as number[])
const frozen: ActionModelV1 = {
  version: 1,
  featureSchemaVersion: 2,
  featureNames: LEARNING_FEATURES_V2,
  labels: ACTION_LABELS,
  weights,
  trainedExamples: 100,
  epochs: 1,
  temperature: 1,
}
const candidate: ActionModelV1 = { ...frozen, calibrationBias: [0, 2, 0, 0] }

function prepared(actorKey: string): PreparedActionShadow {
  return {
    actorKey,
    features: Array(LEARNING_FEATURES_V2.length).fill(0) as number[],
    legalLabels: ['check', 'raise'],
    facingBet: false,
    actor: { betStreet: 0, stack: 100 },
    currentBet: 0,
  }
}

describe('opt-in action shadow', () => {
  it('defers model work, scores only accepted actions, and keeps aggregate timing', async () => {
    const tasks: Array<() => void> = []
    const shadow = new OnlineActionShadow(frozen, candidate, undefined, (task) => tasks.push(task))
    const action = prepared(JSON.stringify(['room', 'person']))
    shadow.accepted(action, { kind: 'check' })
    expect(shadow.stats()).toMatchObject({ forecasts: 0, pending: 1, failed: 0 })
    expect(tasks).toHaveLength(1)
    const drained = shadow.flush()
    tasks.shift()?.()
    await drained
    expect(shadow.stats()).toMatchObject({ forecasts: 1, pending: 0, failed: 0 })
    expect(shadow.stats().meanLogLoss).toBeGreaterThan(0)
    expect(shadow.stats().inferenceP95Ms).not.toBeNull()
    expect(shadow.stats().captureP95Ms).toBeNull()
    expect(() => shadow.accepted(action, { kind: 'fold' })).toThrow('not legal')
    expect(shadow.stats().forecasts).toBe(1)
  })

  it('bounds queued work and erases a departed actor before scoring', async () => {
    const tasks: Array<() => void> = []
    const shadow = new OnlineActionShadow(frozen, candidate, undefined, (task) => tasks.push(task))
    const leaving = prepared(JSON.stringify(['room', 'leaving']))
    const staying = prepared(JSON.stringify(['room', 'staying']))
    for (let index = 0; index < ACTION_SHADOW_LIMITS.maxPending; index += 1) {
      shadow.accepted(leaving, { kind: 'check' })
    }
    shadow.accepted(staying, { kind: 'check' })
    expect(shadow.stats()).toMatchObject({ pending: ACTION_SHADOW_LIMITS.maxPending, dropped: 1 })
    shadow.forgetActor('room', 'leaving')
    expect(shadow.stats()).toMatchObject({
      pending: 0,
      dropped: ACTION_SHADOW_LIMITS.maxPending + 1,
    })
    const drained = shadow.flush()
    tasks.shift()?.()
    await drained
    expect(shadow.stats().forecasts).toBe(0)
    shadow.accepted(staying, { kind: 'check' })
    tasks.shift()?.()
    await shadow.flush()
    expect(shadow.stats().forecasts).toBe(1)
  })
})
