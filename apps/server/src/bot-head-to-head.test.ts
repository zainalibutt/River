import { describe, expect, it } from 'vitest'
import { championPair, duplicateScores, headToHeadPolicy, playDeals } from './bot-head-to-head.js'
import { alwaysCallPolicy, alwaysFoldPolicy } from './bot-lbr.js'

describe('duplicate heads-up matches', () => {
  it('seats the champion against a twin with its own id', () => {
    const [champion, twin] = championPair()
    expect(twin.id).not.toBe(champion.id)
    expect({ ...twin, id: champion.id, name: champion.name }).toEqual(champion)
  })

  it('scores two copies of a policy that ignores its luck as exactly level', () => {
    const forward = playDeals(alwaysCallPolicy, alwaysCallPolicy, 'h2h-test', 2, 0, 6)
    const mirrored = playDeals(alwaysCallPolicy, alwaysCallPolicy, 'h2h-test', 2, 0, 6)
    const scores = duplicateScores(forward, mirrored)
    expect(scores).toHaveLength(12)
    expect(scores.every((row) => row.value === 0)).toBe(true)
  }, 120_000)

  it("gives each policy the other one's cards when the seats swap", () => {
    const forward = playDeals(alwaysCallPolicy, alwaysFoldPolicy, 'h2h-test', 2, 0, 6)
    const mirrored = playDeals(alwaysFoldPolicy, alwaysCallPolicy, 'h2h-test', 2, 0, 6)
    // The caller wins every pot the folder gives up, whichever cards it holds.
    const scores = duplicateScores(forward, mirrored)
    expect(scores.reduce((sum, row) => sum + row.value, 0)).toBeGreaterThan(0)
    forward.forEach((hand, index) => {
      expect(mirrored[index]?.handClass).toBe(hand.handClass)
    })
  }, 120_000)
})

describe('head-to-head names with a preflop pack directory', () => {
  it('accepts only v9gp names with a directory after @', () => {
    expect(headToHeadPolicy('v9x@somewhere')).toBeUndefined()
    expect(headToHeadPolicy('v9gpw2@')).toBeUndefined()
  })
})
