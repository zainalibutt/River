import { describe, expect, it } from 'vitest'
import { sha256Hex } from './index.js'

describe('sha256Hex', () => {
  it('hashes utf8 input', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('is deterministic', async () => {
    const a = await sha256Hex('River')
    const b = await sha256Hex('River')
    expect(a).toBe(b)
  })
})
