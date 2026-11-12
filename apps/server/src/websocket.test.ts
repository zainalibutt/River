import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, type WebSocketServer } from 'ws'
import { readServerResourceConfig, type ServerResourceConfig } from './config.js'
import type { Ledger } from './ledger.js'
import { RoomHub } from './transport.js'
import { attachRiverWebSocketServer, isPrivateAddress } from './websocket.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const servers: { http: ReturnType<typeof createServer>; sockets: WebSocketServer }[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

async function startAdapter(overrides: Partial<ServerResourceConfig> = {}) {
  const http = createServer()
  const hub = new RoomHub({
    ledger: memoryLedger(),
    verifyToken: async () => ({ playerId: PLAYER_ID, anonymous: true, admin: false }),
  })
  const sockets = attachRiverWebSocketServer(http, hub, '/ws', {
    ...readServerResourceConfig({}),
    ...overrides,
  })
  servers.push({ http, sockets })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return { hub, sockets, url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws` }
}

async function openClient(url: string, headers: Record<string, string> = {}) {
  const client = new WebSocket(url, { headers })
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })
  return client
}

async function rejectedUpgrade(url: string, headers: Record<string, string> = {}) {
  const client = new WebSocket(url, { headers })
  return new Promise<number>((resolve, reject) => {
    client.on('error', () => {})
    client.once('open', () => {
      client.close()
      reject(new Error('unexpectedly admitted'))
    })
    client.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0)
      client.terminate()
    })
  })
}

describe('WebSocket admission', () => {
  it('rejects disallowed browser origins before upgrade while allowing absent and listed origins', async () => {
    const { sockets, url } = await startAdapter({ allowedOrigins: ['https://playriver.uk'] })
    expect(await rejectedUpgrade(url, { Origin: 'https://evil.example' })).toBe(403)
    expect(await rejectedUpgrade(url, { Origin: 'null' })).toBe(403)
    expect(sockets.clients.size).toBe(0)
    await openClient(url)
    await openClient(url, { Origin: 'https://playriver.uk' })
    expect(sockets.clients.size).toBe(2)
  })

  it('allows arbitrary origins when no allowlist is configured', async () => {
    const { url, sockets } = await startAdapter()
    await openClient(url, { Origin: 'https://development.example' })
    expect(sockets.clients.size).toBe(1)
  })

  it('enforces a global socket cap and releases capacity on close', async () => {
    const { sockets, url } = await startAdapter({ maxSockets: 1, trustProxy: true })
    const client = await openClient(url, { 'x-forwarded-for': '192.0.2.1' })
    expect(await rejectedUpgrade(url, { 'x-forwarded-for': '192.0.2.2' })).toBe(503)
    const serverClient = [...sockets.clients][0]
    const closed = new Promise<void>((resolve) => serverClient?.once('close', resolve))
    client.close()
    await closed
    await openClient(url, { 'x-forwarded-for': '192.0.2.2' })
    expect(sockets.clients.size).toBe(1)
  })

  it('never caps a private address it does not trust, since that is the proxy in front of everyone', async () => {
    // Every test connection comes from loopback, as every player does from behind Railway's proxy.
    const { sockets, url } = await startAdapter({ maxSocketsPerIp: 1 })
    await openClient(url, { 'x-forwarded-for': '192.0.2.1' })
    await openClient(url, { 'x-forwarded-for': '192.0.2.1' })
    expect(sockets.clients.size).toBe(2)
  })

  it('caps by the address the trusted proxy names, whatever the client forwards', async () => {
    const { sockets, url } = await startAdapter({ maxSocketsPerIp: 1, trustProxy: true })
    const first = await openClient(url, {
      'x-real-ip': '192.0.2.1',
      'x-forwarded-for': '198.51.100.7',
    })
    // The same player, claiming to be somebody else in the header it controls.
    expect(
      await rejectedUpgrade(url, { 'x-real-ip': '192.0.2.1', 'x-forwarded-for': '203.0.113.9' }),
    ).toBe(503)
    await openClient(url, { 'x-real-ip': '192.0.2.2' })
    const serverClient = [...sockets.clients][0]
    const closed = new Promise<void>((resolve) => serverClient?.once('close', resolve))
    first.close()
    await closed
    await openClient(url, { 'x-real-ip': '192.0.2.1' })
    expect(sockets.clients.size).toBe(2)
  })

  it('still caps every socket together when the forwarding header is unusable', async () => {
    const { sockets, url } = await startAdapter({ maxSockets: 1, trustProxy: true })
    await openClient(url, { 'x-real-ip': 'invalid' })
    expect(await rejectedUpgrade(url, { 'x-real-ip': 'also-invalid' })).toBe(503)
    expect(sockets.clients.size).toBe(1)
  })

  it('knows a private address from a public one', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '100.64.0.9',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
    for (const address of [
      '192.0.2.1',
      '8.8.8.8',
      '172.32.0.1',
      '2001:db8::1',
      '::ffff:203.0.113.9',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false)
    }
  })
})

function simulatedClient(receive = vi.fn(async (_raw: string) => {})) {
  const http = createServer()
  const hub = new RoomHub({
    ledger: memoryLedger(),
    verifyToken: async () => ({ playerId: PLAYER_ID, anonymous: true, admin: false }),
  })
  const disconnect = vi.fn(async () => {})
  vi.spyOn(hub, 'connect').mockReturnValue({ receive, close: disconnect })
  const sockets = attachRiverWebSocketServer(http, hub)
  servers.push({ http, sockets })
  const client = Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn((_code: number, _reason: string) => {
      client.emit('close')
    }),
  })
  sockets.emit('connection', client as unknown as WebSocket)
  const message = () => client.emit('message', Buffer.from('{}'), false)
  return { client, message, receive, disconnect }
}

describe('WebSocket message bounds', () => {
  it('caps pending work at 64 and drops queued work after overflow', async () => {
    vi.useFakeTimers()
    let finish = () => {}
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const receive = vi.fn(async (_raw: string) => {
      await wait
    })
    const { message, client, disconnect } = simulatedClient(receive)
    for (let index = 0; index < 60; index += 1) message()
    await vi.advanceTimersByTimeAsync(2_000)
    for (let index = 0; index < 4; index += 1) message()
    expect(client.close).not.toHaveBeenCalled()
    message()
    expect(client.close).toHaveBeenCalledWith(1008, 'Too many messages')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenCalledTimes(1)
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('drops queued messages on a normal socket close', async () => {
    vi.useFakeTimers()
    let finish = () => {}
    const receive = vi.fn(
      async (_raw: string) =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const { client, message } = simulatedClient(receive)
    message()
    message()
    await vi.advanceTimersByTimeAsync(0)
    client.emit('close')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    message()
    expect(receive).toHaveBeenCalledTimes(1)
  })

  it('admits a burst of 60, refills at 30 per second and drops occasional excess', async () => {
    vi.useFakeTimers()
    const { message, client, receive } = simulatedClient()
    for (let index = 0; index < 61; index += 1) message()
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenCalledTimes(60)
    expect(client.close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    for (let index = 0; index < 31; index += 1) message()
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenCalledTimes(90)
    expect(client.close).not.toHaveBeenCalled()
  })

  it('closes persistent flooding after more than a burst arrives while empty', async () => {
    vi.useFakeTimers()
    const { message, client, receive } = simulatedClient()
    for (let index = 0; index < 120; index += 1) message()
    expect(client.close).not.toHaveBeenCalled()
    message()
    expect(client.close).toHaveBeenCalledWith(1008, 'Message rate exceeded')
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).not.toHaveBeenCalled()
  })
})
