import { describe, expect, it } from 'vitest'
import { botCapabilitiesRoute } from './bot-capabilities-route.js'

describe('bot capability route', () => {
  it.each([false, true])(
    'reports the running hub capability (%s), without caching',
    async (enabled) => {
      const response = await botCapabilitiesRoute(enabled).handle(
        new Request('http://river.local/api/bot-capabilities'),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ midasAvailable: enabled })
    },
  )

  it('does not answer other paths under the prefix', async () => {
    expect(
      (
        await botCapabilitiesRoute(true).handle(
          new Request('http://river.local/api/bot-capabilities/other'),
        )
      ).status,
    ).toBe(404)
  })
})
