import { describe, expect, it, vi } from 'vitest'
import { botAdmissionDestination, botCapabilities, midasAvailable } from './bot-capabilities'

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

  it.each([0, 1, 3])(
    'reads live free capacity including the busy state (%i free)',
    async (free) => {
      const body = { midasAvailable: true, midasSeats: 3, midasSeatsFree: free }
      expect(
        await botCapabilities(vi.fn<typeof fetch>().mockResolvedValue(Response.json(body))),
      ).toEqual(body)
    },
  )

  it('fails closed on missing, inconsistent and malformed counts', async () => {
    for (const counts of [
      {},
      { midasSeats: 3, midasSeatsFree: -1 },
      { midasSeats: 3, midasSeatsFree: 4 },
      { midasSeats: 3, midasSeatsFree: '1' },
      { midasSeats: 3, midasSeatsFree: 0.5 },
      { midasSeats: 0, midasSeatsFree: 0 },
    ]) {
      expect(
        await botCapabilities(
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(Response.json({ midasAvailable: true, ...counts })),
        ),
      ).toEqual({ midasAvailable: true, midasSeats: 0, midasSeatsFree: 0 })
    }
    expect(
      await botCapabilities(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            Response.json({ midasAvailable: false, midasSeats: 3, midasSeatsFree: 3 }),
          ),
      ),
    ).toEqual({ midasAvailable: false, midasSeats: 0, midasSeatsFree: 0 })
  })

  it('returns a midas_busy race refusal to the menu with the busy notice', () => {
    expect(botAdmissionDestination('midas_busy')).toBe('/?midas=busy')
    expect(botAdmissionDestination('command_rejected')).toBeNull()
  })
})
