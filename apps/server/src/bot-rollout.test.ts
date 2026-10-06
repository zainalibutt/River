import { mulberry32, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { bucketAction, bucketOf, rolloutValue } from './bot-rollout.js'
import { profileFor } from './bot-service.js'
import { type FocalDecisionPoint, runSessions } from './bot-session-benchmark.js'
import { heldOutStylePolicy } from './bot-style-opponents.js'
import {
  headsUpOpponent,
  learnedValuePolicy,
  predict,
  trainValueNetwork,
  VALUE_FEATURES,
  valueFeatures,
} from './bot-value-model.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}

function capture(): FocalDecisionPoint[] {
  const points: FocalDecisionPoint[] = []
  runSessions({
    seed: 'rollout-test',
    sessions: 2,
    handsPerSession: 30,
    table: {
      name: 'heads-up-balanced',
      style: 'balanced',
      entrants: [
        { personality: person(10) },
        { personality: person(0), policy: heldOutStylePolicy('balanced') },
      ],
    },
    focalPolicy: pokerGuardPolicy,
    plugin: opponentStatsPlugin(),
    onFocalDecision: (point) => {
      if (headsUpOpponent(point.observation) !== null) points.push(point)
    },
  })
  return points
}

describe('rollouts from a replayed decision', () => {
  const points = capture()

  it('finds heads-up decisions after the flop and replays each one exactly', () => {
    expect(points.length).toBeGreaterThan(5)
    for (const point of points.slice(0, 8)) {
      const bucket = point.observation.amountToCall > 0 ? 1 : 0
      const action = bucketAction(point.observation, bucket)
      if (action === null) continue
      expect(() => rolloutValue(point, action, pokerGuardPolicy, 'replay')).not.toThrow()
    }
  })

  it('values a fold at exactly nothing more lost, and repeats a seed exactly', () => {
    const facing = points.find((point) => point.observation.amountToCall > 0)
    if (facing === undefined) throw new Error('no facing decision captured')
    expect(rolloutValue(facing, { kind: 'fold' }, pokerGuardPolicy, 'fold')).toBe(0)
    const call = bucketAction(facing.observation, 1)
    if (call === null) throw new Error('call not legal')
    expect(rolloutValue(facing, call, pokerGuardPolicy, 'same')).toBe(
      rolloutValue(facing, call, pokerGuardPolicy, 'same'),
    )
  })

  it('maps a policy decision back to the bucket it stands for', () => {
    const free = points.find((point) => point.observation.amountToCall === 0)
    if (free === undefined) throw new Error('no free decision captured')
    expect(bucketOf(free.observation, { kind: 'check' })).toBe(0)
    const small = bucketAction(free.observation, 1)
    const large = bucketAction(free.observation, 2)
    if (small !== null && small.kind === 'raiseTo')
      expect(bucketOf(free.observation, small)).toBe(1)
    if (large !== null && large.kind === 'raiseTo' && large.to > free.observation.pot * 0.75) {
      expect(bucketOf(free.observation, large)).toBe(2)
    }
  })

  it('reads the legal observation into a finite feature vector of the declared length', () => {
    const features = valueFeatures(points[0]?.observation as FocalDecisionPoint['observation'])
    expect(features).toHaveLength(VALUE_FEATURES.length)
    expect(features?.every((value) => Number.isFinite(value))).toBe(true)
  })
})

describe('value network training', () => {
  it('learns a planted relationship and ignores buckets without a target', () => {
    const examples = Array.from({ length: 400 }, (_, index) => {
      const a = (index % 20) / 20
      const b = ((index * 7) % 13) / 13
      return { x: [a, b], targets: [2 * a - b, index % 2 === 0 ? null : a, 0.5] }
    })
    const network = trainValueNetwork(examples, {
      hidden: 16,
      epochs: 200,
      batch: 32,
      learningRate: 0.01,
      l2: 0,
      huberDelta: 1,
      seed: 7,
    })
    expect(predict(network, [0.8, 0.1])[0]).toBeCloseTo(1.5, 1)
    expect(predict(network, [0.2, 0.9])[0]).toBeCloseTo(-0.5, 1)
    expect(predict(network, [0.5, 0.5])[2]).toBeCloseTo(0.5, 1)
  })
})

describe('learned value policy', () => {
  const points = capture()
  const flat = (bias: readonly number[]) => ({
    inputs: VALUE_FEATURES.length,
    hidden: 1,
    outputs: 3,
    mean: new Array(VALUE_FEATURES.length).fill(0),
    scale: new Array(VALUE_FEATURES.length).fill(1),
    w1: new Array(VALUE_FEATURES.length).fill(0),
    b1: [0],
    w2: [0, 0, 0],
    b2: [...bias],
  })
  const contextFor = (point: FocalDecisionPoint, skill: 'og' | 'novice') => {
    const personality = { ...person(skill === 'og' ? 10 : 4) }
    return {
      observation: point.observation,
      profile: profileFor(personality),
      personality,
      tilt: point.observation.tilt,
      rng: mulberry32(11),
    }
  }

  it('takes the model’s bucket only when it clears the margin, and only for an OG heads-up after the flop', () => {
    const free = points.find((point) => point.observation.amountToCall === 0)
    if (free === undefined) throw new Error('no free decision captured')
    const model = {
      version: 1 as const,
      features: [...VALUE_FEATURES],
      networks: { facing: flat([0, 0, 0]), free: flat([0, 0, 5]) },
    }
    const overrides: string[] = []
    const policy = learnedValuePolicy(model, {
      base: pokerGuardPolicy,
      margins: { facing: 0.3, free: 0.3 },
      onOverride: (from, to) => overrides.push(`${from}>${to}`),
    })
    const base = pokerGuardPolicy.decide(contextFor(free, 'og')).decision
    const learned = policy.decide(contextFor(free, 'og')).decision
    if (bucketOf(free.observation, base) !== 2) {
      expect(learned).toEqual(bucketAction(free.observation, 2))
      expect(overrides).toHaveLength(1)
    }
    const shy = learnedValuePolicy(model, {
      base: pokerGuardPolicy,
      margins: { facing: 9, free: 9 },
    })
    expect(shy.decide(contextFor(free, 'og')).decision).toEqual(base)
    expect(policy.decide(contextFor(free, 'novice')).decision).toEqual(
      pokerGuardPolicy.decide(contextFor(free, 'novice')).decision,
    )
  })
})
