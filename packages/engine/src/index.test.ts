import { describe, expect, it } from 'vitest'
import { makeDeck, sha256Hex } from './index.js'

describe('engine barrel', () => {
  it('hashes utf8 input', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('exposes a full deck', () => {
    expect(makeDeck()).toHaveLength(52)
  })
})
