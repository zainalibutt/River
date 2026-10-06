import { describe, expect, it } from 'vitest'
import { commitSeed, randomSeed, sha256Hex, verifyCommit } from './fair.js'

describe('fair seed helpers', () => {
  it('hashes a known vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('produces deterministic commits', () => {
    expect(commitSeed('river-seed')).toBe(commitSeed('river-seed'))
  })

  it('verifies a commit against its seed', () => {
    const seed = 'supersecret'
    const commit = commitSeed(seed)
    expect(verifyCommit(commit, seed)).toBe(true)
    expect(verifyCommit(commit, `${seed}x`)).toBe(false)
  })

  it('generates 64-hex-char seeds', () => {
    expect(randomSeed()).toMatch(/^[0-9a-f]{64}$/)
    expect(randomSeed()).not.toBe(randomSeed())
  })
})
