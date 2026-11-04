import { describe, expect, it, vi } from 'vitest'
import { midasAvailable } from './bot-capabilities'

describe('live server Midas capability', () => {
  it('requests an uncached capability and accepts only literal true', async () => {
    for (const body of [
      { midasAvailable: true },
      { midasAvailable: false },
      {},
      null,
      { midasAvailable: 'true' },
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))
      expect(await midasAvailable(fetcher)).toBe(body?.midasAvailable === true)
      expect(fetcher).toHaveBeenCalledWith('/api/bot-capabilities', { cache: 'no-store' })
    }
  })

  it('hides Midas on HTTP, JSON, and network failures', async () => {
    expect(
      await midasAvailable(
        vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 404 })),
      ),
    ).toBe(false)
    expect(
      await midasAvailable(vi.fn<typeof fetch>().mockResolvedValue(new Response('bad json'))),
    ).toBe(false)
    expect(
      await midasAvailable(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))),
    ).toBe(false)
  })
})
