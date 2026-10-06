import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Challenge, MetricTally } from './challenges.js'
import { challengePool, completedRepReward, dailySet, progressFor } from './challenges.js'

const POOL = challengePool()
const METRICS = [
  'handsPlayed',
  'handsWon',
  'showdownsReached',
  'potsScooped',
  'foldsPreflop',
  'allInsSurvived',
] as const

function poolEntry0(): Challenge {
  const first = POOL[0]
  if (first === undefined) throw new Error('challenge pool is empty')
  return first
}

function poolEntry1(): Challenge {
  const second = POOL[1]
  if (second === undefined) throw new Error('challenge pool has fewer than two entries')
  return second
}

describe('dailySet determinism', () => {
  it('returns the same set for the same seed across repeated calls', () => {
    for (const seed of [0, 1, 42, 99_999, 2_147_483_647]) {
      expect(dailySet(seed)).toEqual(dailySet(seed))
      expect(dailySet(seed, 4)).toEqual(dailySet(seed, 4))
    }
  })

  it('returns different sets for most different seeds', () => {
    let differing = 0
    for (let seed = 0; seed < 50; seed += 1) {
      const left = dailySet(seed)
      const right = dailySet(seed + 1)
      if (left.some((challenge, index) => challenge.id !== right[index]?.id)) {
        differing += 1
      }
    }
    expect(differing).toBeGreaterThan(40)
  })

  it('contains no duplicate challenge ids in a single set', () => {
    for (const seed of [0, 3, 1000]) {
      const ids = dailySet(seed).map((challenge) => challenge.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('returns fewer items than the pool when a count is requested', () => {
    expect(dailySet(7, 5)).toHaveLength(5)
  })
})

describe('challenge pool', () => {
  it('has unique ids and a positive integer reward for every entry', () => {
    const ids = POOL.map((challenge) => challenge.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(POOL.length).toBeGreaterThanOrEqual(14)
    for (const challenge of POOL) {
      expect(Number.isSafeInteger(challenge.repReward)).toBe(true)
      expect(challenge.repReward).toBeGreaterThan(0)
      expect(Number.isSafeInteger(challenge.target)).toBe(true)
      expect(challenge.target).toBeGreaterThan(0)
    }
  })

  it('spans all six metrics', () => {
    for (const metric of METRICS) {
      expect(POOL.some((challenge) => challenge.metric === metric)).toBe(true)
    }
  })

  it('imports nothing from rep, rep-progression or table-items', () => {
    const source = readFileSync(fileURLToPath(new URL('./challenges.ts', import.meta.url)), 'utf8')
    for (const forbidden of ['./rep-progression.js', './rep.js', './table-items.js']) {
      expect(source).not.toContain(`from '${forbidden}'`)
    }
  })
})

describe('progressFor', () => {
  it('treats a missing metric as zero progress, not NaN', () => {
    const challenge: Challenge = poolEntry0()
    const progress = progressFor(challenge, {})
    expect(progress.current).toBe(0)
    expect(progress.fractionComplete).toBe(0)
    expect(Number.isNaN(progress.fractionComplete)).toBe(false)
  })

  it('keeps fraction within zero and one when the tally overshoots', () => {
    const challenge = poolEntry0()
    const progress = progressFor(challenge, { [challenge.metric]: challenge.target * 10 })
    expect(progress.fractionComplete).toBe(1)
    expect(progress.current).toBe(challenge.target * 10)
  })

  it('marks complete exactly when current reaches the target', () => {
    const challenge = poolEntry0()
    const below = progressFor(challenge, { [challenge.metric]: challenge.target - 1 })
    const exact = progressFor(challenge, { [challenge.metric]: challenge.target })
    const above = progressFor(challenge, { [challenge.metric]: challenge.target + 5 })
    expect(below.complete).toBe(false)
    expect(exact.complete).toBe(true)
    expect(above.complete).toBe(true)
  })

  it('clamps a negative tally to zero progress', () => {
    const challenge = poolEntry0()
    const progress = progressFor(challenge, { [challenge.metric]: -5 })
    expect(progress.current).toBe(0)
    expect(progress.fractionComplete).toBe(0)
  })
})

describe('completedRepReward', () => {
  it('counts only complete challenges exactly once', () => {
    const challenge = poolEntry0()
    const complete: MetricTally = { [challenge.metric]: challenge.target }
    expect(completedRepReward([challenge], complete)).toBe(challenge.repReward)
    expect(completedRepReward([challenge, challenge], complete)).toBe(challenge.repReward)
  })

  it('ignores incomplete challenges', () => {
    const challenge = poolEntry0()
    const incomplete: MetricTally = { [challenge.metric]: 0 }
    expect(completedRepReward([challenge], incomplete)).toBe(0)
  })

  it('sums the reward for multiple complete challenges without double counting', () => {
    const first = poolEntry0()
    const second = poolEntry1()
    const tally: MetricTally = {
      [first.metric]: first.target,
      [second.metric]: second.target,
    }
    expect(completedRepReward([first, second], tally)).toBe(first.repReward + second.repReward)
  })
})
