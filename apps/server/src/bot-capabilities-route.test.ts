import { describe, expect, it } from 'vitest'
import { botCapabilitiesRoute } from './bot-capabilities-route.js'
import { RoomHub } from './transport.js'

function hub(enabled: boolean) {
  return new RoomHub({
    verifyToken: async () => ({ playerId: 'human', anonymous: true, admin: false }),
    ledger: { balance: async () => 100_000, apply: async () => 100_000 },
    ...(enabled
      ? {
          midas: {
            seats: 3,
            budgetMs: 8000,
            thinker: { wants: () => true, think: async () => null, close: async () => {} },
          },
        }
      : {}),
  })
}

describe('bot capability route', () => {
  it.each([false, true])(
    'reports the running hub capability (%s), without caching',
    async (enabled) => {
      const response = await botCapabilitiesRoute(hub(enabled)).handle(
        new Request('http://river.local/api/bot-capabilities'),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        midasAvailable: enabled,
        midasSeats: enabled ? 3 : 0,
        midasSeatsFree: enabled ? 3 : 0,
      })
    },
  )

  it('does not answer other paths under the prefix', async () => {
    expect(
      (
        await botCapabilitiesRoute(hub(true)).handle(
          new Request('http://river.local/api/bot-capabilities/other'),
        )
      ).status,
    ).toBe(404)
  })

  it('reads counts from the same live hub on every request', async () => {
    const live = hub(true)
    const route = botCapabilitiesRoute(live)
    const read = async () =>
      (await route.handle(new Request('http://river.local/api/bot-capabilities'))).json()
    const connection = live.connect({ send: () => {}, close: () => {} })
    await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: 'token' }))
    await connection.receive(
      JSON.stringify({
        kind: 'enter',
        requestId: 'enter',
        roomId: 'midas',
        name: 'Human',
        botPreset: 'midas',
      }),
    )
    expect(await read()).toMatchObject({ midasSeats: 3, midasSeatsFree: 3 })
    await connection.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    expect(await read()).toEqual({ midasAvailable: true, midasSeats: 3, midasSeatsFree: 2 })
    await connection.receive(
      JSON.stringify({ kind: 'command', requestId: 'leave', command: { kind: 'leave' } }),
    )
    expect(await read()).toMatchObject({ midasSeats: 3, midasSeatsFree: 3 })
  })
})
