import type { Server as HttpServer } from 'node:http'
import { isIP } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { readServerResourceConfig, type ServerResourceConfig } from './config.js'
import type { RoomHub } from './transport.js'

export function attachRiverWebSocketServer(
  server: HttpServer,
  hub: RoomHub,
  path = '/ws',
  config: ServerResourceConfig = readServerResourceConfig(process.env),
): WebSocketServer {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
  const socketsPerIp = new Map<string, number>()
  let openSockets = 0
  server.on('upgrade', (request, socket, head) => {
    const requestPath = new URL(request.url ?? '/', 'http://river.local').pathname
    // Leave every other upgrade alone rather than destroying it. This server
    // also hosts Next, whose dev hot reload arrives as an upgrade on its own
    // path, and a socket nobody claims is closed by the runtime anyway.
    if (requestPath !== path) return
    const origin = request.headers.origin
    if (
      origin !== undefined &&
      config.allowedOrigins !== null &&
      !config.allowedOrigins.includes(origin)
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    // Behind a trusted proxy, the client's address is the one the proxy names
    // in X-Real-IP; Railway sets it. X-Forwarded-For is not used: its hops are
    // partly whatever the client sent, and the chain is not fixed.
    const realIp = request.headers['x-real-ip']
    const named = (Array.isArray(realIp) ? realIp[0] : realIp)?.trim()
    const remote = request.socket.remoteAddress ?? 'unknown'
    const trusted = config.trustProxy && named !== undefined && isIP(named) !== 0
    const ip = trusted ? named : remote
    // An untrusted private address is a proxy in front of every player, or a
    // developer's own machine, so counting it per address would cap the whole
    // game at one address's share.
    const limitPerIp = trusted || !isPrivateAddress(remote)
    const perIp = socketsPerIp.get(ip) ?? 0
    if (openSockets >= config.maxSockets || (limitPerIp && perIp >= config.maxSocketsPerIp)) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      )
      return
    }
    // Reserve before the handshake, including upgrades that have not finished.
    openSockets += 1
    socketsPerIp.set(ip, perIp + 1)
    socket.once('close', () => {
      openSockets -= 1
      const remaining = (socketsPerIp.get(ip) ?? 1) - 1
      if (remaining === 0) socketsPerIp.delete(ip)
      else socketsPerIp.set(ip, remaining)
    })
    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit('connection', client, request)
    })
  })
  sockets.on('connection', (client) => {
    let stopped = false
    const close = (code: number, reason: string): void => {
      stopped = true
      client.close(code, reason)
    }
    const connection = hub.connect({
      send: (message) => {
        if (client.readyState === WebSocket.OPEN) client.send(message)
      },
      close,
    })
    let queue = Promise.resolve()
    let pending = 0
    let tokens = 60
    let lastRefillMs = Date.now()
    let exhaustedMessages = 0
    client.on('message', (data, binary) => {
      if (stopped) return
      if (binary) {
        close(1003, 'Text messages only')
        return
      }
      const now = Date.now()
      tokens = Math.min(60, tokens + (Math.max(0, now - lastRefillMs) * 30) / 1_000)
      lastRefillMs = now
      if (tokens < 1) {
        exhaustedMessages += 1
        if (exhaustedMessages > 60) close(1008, 'Message rate exceeded')
        return
      }
      tokens -= 1
      exhaustedMessages = 0
      if (pending >= 64) {
        close(1008, 'Too many messages')
        return
      }
      pending += 1
      queue = queue
        .then(() => {
          if (!stopped) return connection.receive(data.toString())
        })
        .catch(() => {
          close(1011, 'Server error')
        })
        .finally(() => {
          pending -= 1
        })
    })
    client.once('close', () => {
      stopped = true
      void connection.close()
    })
  })
  return sockets
}

/** Loopback, private, carrier-grade NAT and link-local addresses, IPv4 or IPv6. */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^::ffff:/, '')
  if (isIP(value) === 4) {
    const [a = 0, b = 0] = value.split('.').map(Number)
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254)
    )
  }
  if (isIP(value) === 6) {
    return value === '::1' || /^f[cd]/.test(value) || /^fe[89ab]/.test(value)
  }
  return true
}
