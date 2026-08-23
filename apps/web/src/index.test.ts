import { describe, expect, it } from 'vitest'
import { appName } from './index.js'

describe('web stub', () => {
  it('exposes its name', () => {
    expect(appName).toBe('river-web')
  })
})
