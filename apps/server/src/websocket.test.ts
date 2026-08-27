import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, type WebSocketServer } from 'ws'
import type { Ledger } from './ledger.js'
import { RoomHub } from './transport.js'
import { attachRiverWebSocketServer } from './websocket.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const servers: { http: ReturnType<typeof createServer>; sockets: WebSocketServer }[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ http, sockets }) =>
        new Promise<void>((resolve) => {
          for (const client of sockets.clients) client.terminate()
          sockets.close(() => http.close(() => resolve()))
        }),
    ),
  )
})

function memoryLedger(): Ledger {
  return {
    balance: async () => 100_000,
    apply: async ({ delta }) => 100_000 + delta,
  }
}

describe('WebSocket adapter', () => {
  it('carries authenticated River messages over a real socket', async () => {
    const http = createServer((_request, response) => {
      response.writeHead(200).end('river')
    })
    const hub = new RoomHub({
      ledger: memoryLedger(),
      verifyToken: async () => ({ playerId: PLAYER_ID, anonymous: true, admin: false }),
    })
    const sockets = attachRiverWebSocketServer(http, hub)
    servers.push({ http, sockets })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as AddressInfo).port
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    const reply = new Promise<string>((resolve) => {
      client.once('message', (data) => resolve(data.toString()))
    })
    client.send(JSON.stringify({ kind: 'authenticate', accessToken: 'valid' }))
    expect(JSON.parse(await reply)).toEqual({
      kind: 'authenticated',
      playerId: PLAYER_ID,
      anonymous: true,
      admin: false,
    })
    client.close()
  })

  it('leaves an upgrade on another path for whoever else is listening', async () => {
    const http = createServer((_request, response) => {
      response.writeHead(200).end('river')
    })
    const hub = new RoomHub({
      ledger: memoryLedger(),
      verifyToken: async () => ({ playerId: PLAYER_ID, anonymous: true, admin: false }),
    })
    const sockets = attachRiverWebSocketServer(http, hub)
    servers.push({ http, sockets })

    // Next serves hot reload from this server on its own path. Destroying the
    // socket instead of passing it on leaves the page loading but never
    // updating, which reads as a broken build rather than a broken server.
    // Both listeners run either way, so seeing the request is not the test.
    // What matters is that the socket is still alive when it arrives.
    const claimed: { path: string; alive: boolean }[] = []
    http.on('upgrade', (request, socket) => {
      claimed.push({
        path: new URL(request.url ?? '/', 'http://river.local').pathname,
        alive: !socket.destroyed,
      })
      socket.destroy()
    })

    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as AddressInfo).port
    const client = new WebSocket(`ws://127.0.0.1:${port}/_next/hmr`)
    await new Promise<void>((resolve) => {
      client.once('error', () => resolve())
      client.once('close', () => resolve())
    })
    expect(claimed).toEqual([{ path: '/_next/hmr', alive: true }])
    expect(sockets.clients.size).toBe(0)
  })
})
