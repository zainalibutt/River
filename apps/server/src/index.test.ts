import { describe, expect, it } from 'vitest'
import { serverName } from './index.js'

describe('server stub', () => {
  it('exposes its name', () => {
    expect(serverName).toBe('river-server')
  })
})
