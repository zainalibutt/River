import { describe, expect, it } from 'vitest'
import type { ApiRoute } from './api-routes.js'
import type { AuthenticatedPlayer } from './auth.js'
import type { Ledger } from './ledger.js'
import type { VenueId } from './protocol.js'
import { defaultRoomConfig, Room } from './room.js'
import { type TableDirectory, tableLinkRoute } from './table-link-route.js'
import { type ClientPeer, RoomHub } from './transport.js'

/**
 * A short link is a table's invite code and nothing else, so the server has to
 * say which live table the code belongs to - or that it belongs to none.
 *
 * Getting this wrong in one direction sends a friend to an empty table, or to a
 * table of bots dealing to one another, where the person who invited them has
 * long since gone. In the other it turns them away from a game that is still
 * being played.
 */

const PLAYERS: Readonly<Record<string, AuthenticatedPlayer>> = {
  alice: { playerId: '323c30d2-9e36-4c4d-96c8-a315322b113d', anonymous: false, admin: false },
  bob: { playerId: '78047f44-a536-4861-9d8f-784d77bda917', anonymous: true, admin: false },
}

const ledger: Ledger = {
  balance: async () => 100_000,
  apply: async ({ delta }) => 100_000 + delta,
}

const peer: ClientPeer = { send: () => undefined, close: () => undefined }

/** A hub that deals every table it opens the invite code RIVER2. */
function roomHub(): RoomHub {
  return new RoomHub({
    ledger,
    verifyToken: async (token) => {
      const player = PLAYERS[token]
      if (player === undefined) throw new Error('invalid token')
      return player
    },
    createRoom: (roomId, settings) =>
      new Room(
        roomId,
        defaultRoomConfig({
          seed: roomId,
          inviteCode: 'RIVER2',
          ...(settings?.venueId === undefined ? {} : { venueId: settings.venueId }),
        }),
      ),
  })
}

async function enter(hub: RoomHub, token: string, roomId: string, venueId?: VenueId) {
  const connection = hub.connect(peer)
  await connection.receive(JSON.stringify({ kind: 'authenticate', accessToken: token }))
  await connection.receive(
    JSON.stringify({
      kind: 'enter',
      requestId: `enter-${token}`,
      roomId,
      name: token,
      ...(venueId === undefined ? {} : { venueId }),
    }),
  )
  return connection
}

function lookUp(route: ApiRoute, code: string): Promise<Response> {
  return route.handle(new Request(`http://river.test/api/tables/by-code/${code}`))
}

describe('resolving a short table link', () => {
  it('names the room and venue of the live table a code belongs to', async () => {
    const hub = roomHub()
    await enter(hub, 'alice', 'river-a26e84b0', 'basement')
    const response = await lookUp(tableLinkRoute(hub), 'RIVER2')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ roomId: 'river-a26e84b0', venueId: 'basement' })
  })

  it('reads a code whatever case it was typed in', async () => {
    const hub = roomHub()
    await enter(hub, 'alice', 'river-a26e84b0')
    const response = await lookUp(tableLinkRoute(hub), 'river2')
    expect(await response.json()).toEqual({ roomId: 'river-a26e84b0', venueId: 'rooftop' })
  })

  it('says a code no table holds has closed', async () => {
    const hub = roomHub()
    await enter(hub, 'alice', 'river-a26e84b0')
    const response = await lookUp(tableLinkRoute(hub), 'CVNDK8')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'That table has closed.' })
  })

  it('closes a code once everybody has left its table', async () => {
    // The hub keeps every room it ever opened, so being in memory is not the
    // same as being open.
    const hub = roomHub()
    const alice = await enter(hub, 'alice', 'river-a26e84b0')
    await alice.close()
    expect((await lookUp(tableLinkRoute(hub), 'RIVER2')).status).toBe(404)
  })

  it('keeps a table open while a player who dropped still holds a seat', async () => {
    // A reload or a lost connection keeps the seat for the reconnect grace, and
    // the person who sent the link is still at that table.
    const hub = roomHub()
    const alice = await enter(hub, 'alice', 'river-a26e84b0')
    await alice.receive(
      JSON.stringify({
        kind: 'command',
        requestId: 'alice-sit',
        command: { kind: 'sit', seat: 0, buyIn: 50_000 },
      }),
    )
    await alice.close()
    const response = await lookUp(tableLinkRoute(hub), 'RIVER2')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ roomId: 'river-a26e84b0', venueId: 'rooftop' })
  })

  it('opens neither of two live tables that share a code', async () => {
    // Either could be the wrong one, and both are private.
    const hub = roomHub()
    await enter(hub, 'alice', 'river-a26e84b0')
    await enter(hub, 'bob', 'river-0f9e1c22')
    expect((await lookUp(tableLinkRoute(hub), 'RIVER2')).status).toBe(404)
  })

  it('refuses a malformed code without looking it up', async () => {
    const asked: string[] = []
    const tables: TableDirectory = {
      liveTableForInviteCode: (code) => {
        asked.push(code)
        return null
      },
    }
    const route = tableLinkRoute(tables)
    for (const code of ['', 'RIVER', 'RIVER22', 'RIV%20R2', 'RIVER2%2F', 'RIVER2/x', '%E0%A4%A']) {
      const response = await lookUp(route, code)
      expect(response.status, code).toBe(400)
      expect(await response.json()).toEqual({ error: 'That is not a table code.' })
    }
    expect(asked).toEqual([])
  })

  it('is never cached, because a table closes when its last player leaves', async () => {
    const hub = roomHub()
    await enter(hub, 'alice', 'river-a26e84b0')
    const route = tableLinkRoute(hub)
    for (const code of ['RIVER2', 'CVNDK8', 'nope']) {
      expect((await lookUp(route, code)).headers.get('cache-control')).toBe('no-store')
    }
  })
})
